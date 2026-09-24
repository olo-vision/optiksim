/**
 * Registry aller optischen Elementarten.
 *
 * Eine neue Objektart wird ausschließlich hier registriert:
 *   - Stammdaten (Name, Kategorie, Beschreibung)
 *   - Standardwerte (Factory)
 *   - Inspector-Felder (deklarativ)
 * Darstellung (scene/elements) und Raytracing (engine/raytracing) wählen
 * ihre Implementierung anhand der `family`.
 */
import type {
  Appearance,
  ElementFamily,
  ElementKind,
  LensElement,
  LensKind,
  LensParams,
  MediumElement,
  MediumRef,
  OpticalElement,
  PlateElement,
  PrismElement,
} from './types';
import type { FieldGroup } from './fieldSchema';
import { findMedium } from './media';
import { frontRadiusForBackVertexPower } from '@/engine/physics/formulas';

export type ElementCategory = 'Linsen' | 'Augenoptik' | 'Weitere Optik';

type ElementDraft = Omit<OpticalElement, 'id' | 'name' | 'transform' | 'visible' | 'locked'>;

export interface ElementDefinition {
  kind: ElementKind;
  family: ElementFamily;
  label: string;
  category: ElementCategory;
  description: string;
  /** Typischer Abstand Hornhautscheitel → rückseitiger Scheitel beim Einfügen [mm] */
  defaultDistance: number;
  /** Direkt auf die Hornhaut setzen (Kontaktlinsen) */
  placeOnCornea?: boolean;
  create: () => ElementDraft;
  /** Elementspezifische Inspector-Gruppen (Transform/Material kommen generisch dazu) */
  fields: FieldGroup<OpticalElement>[];
}

/* ---------------------------- Helfer ---------------------------- */

const medium = (id: string): MediumRef => {
  const m = findMedium(id);
  return { presetId: id, n: m?.n ?? 1.5, abbe: m?.abbe };
};

const glass = (tint = '#dfeef7', transparency = 0.92): Appearance => ({ tint, transparency, finish: 'clear' });

const lensParams = (p: Partial<LensParams>): LensParams => ({
  diameter: 40,
  centerThickness: 4,
  frontRadius: 100,
  backRadius: -100,
  outline: 'round',
  width: 50,
  height: 40,
  ...p,
});

const lensDraft = (kind: LensKind, mediumId: string, p: Partial<LensParams>, extra: Partial<LensElement> = {}): ElementDraft =>
  ({
    entityType: 'element',
    family: 'lens',
    kind,
    medium: medium(mediumId),
    appearance: glass(),
    physics: {},
    lens: lensParams(p),
    ...extra,
  }) as LensElement;

const isLens = (e: OpticalElement): e is LensElement => e.family === 'lens';

/* ------------------------- Feldgruppen -------------------------- */

const lensGeometryFields = (opts: { outline?: boolean; frontLabel?: string; backLabel?: string } = {}): FieldGroup<OpticalElement> => ({
  id: 'geometry',
  title: 'Abmessungen',
  fields: [
    ...(opts.outline
      ? [
          {
            type: 'select' as const,
            path: 'lens.outline',
            label: 'Form',
            options: [
              { value: 'round', label: 'Rund' },
              { value: 'oval', label: 'Oval' },
              { value: 'rect', label: 'Rechteckig' },
            ],
          },
        ]
      : []),
    {
      type: 'number',
      path: 'lens.diameter',
      label: 'Durchmesser',
      unit: 'mm',
      min: 1,
      max: 120,
      step: 0.5,
      decimals: 1,
      visibleIf: (e) => !isLens(e) || e.lens.outline === 'round',
    },
    { type: 'number', path: 'lens.width', label: 'Scheibenbreite', unit: 'mm', min: 5, max: 120, step: 0.5, decimals: 1, visibleIf: (e) => isLens(e) && e.lens.outline !== 'round' },
    { type: 'number', path: 'lens.height', label: 'Scheibenhöhe', unit: 'mm', min: 5, max: 120, step: 0.5, decimals: 1, visibleIf: (e) => isLens(e) && e.lens.outline !== 'round' },
    { type: 'number', path: 'lens.centerThickness', label: 'Mittendicke', unit: 'mm', min: 0.02, max: 60, step: 0.1, decimals: 2 },
  ],
});

const lensSurfaceFields = (frontLabel = 'Vorderflächenradius r₁', backLabel = 'Rückflächenradius r₂'): FieldGroup<OpticalElement> => ({
  id: 'surfaces',
  title: 'Flächen',
  fields: [
    { type: 'number', path: 'lens.frontRadius', label: frontLabel, unit: 'mm', min: -10000, max: 10000, step: 0.5, decimals: 2, zeroMeansInfinity: true, hint: 'r > 0: Krümmungsmittelpunkt in Lichtrichtung hinter dem Scheitel. 0 = plan.' },
    { type: 'number', path: 'lens.backRadius', label: backLabel, unit: 'mm', min: -10000, max: 10000, step: 0.5, decimals: 2, zeroMeansInfinity: true, hint: 'r > 0: Krümmungsmittelpunkt in Lichtrichtung hinter dem Scheitel. 0 = plan.' },
  ],
});

const contactFields: FieldGroup<OpticalElement> = {
  id: 'contact',
  title: 'Kontaktlinse',
  fields: [
    {
      type: 'select',
      path: 'contact.design',
      label: 'Linsentyp',
      options: [
        { value: 'rigid', label: 'Formstabil' },
        { value: 'soft', label: 'Weich' },
      ],
    },
    { type: 'number', path: 'lens.backRadius', label: 'Basiskurve r₀', unit: 'mm', min: 5, max: 12, step: 0.05, decimals: 2, hint: 'Rückflächen-Scheitelradius (Basiskurve, BOZR)' },
    { type: 'number', path: 'lens.diameter', label: 'Gesamtdurchmesser Ø', unit: 'mm', min: 6, max: 18, step: 0.1, decimals: 1 },
    { type: 'number', path: 'lens.centerThickness', label: 'Mittendicke t_c', unit: 'mm', min: 0.03, max: 0.8, step: 0.01, decimals: 2 },
    { type: 'number', path: 'lens.frontRadius', label: 'Vorderflächenradius', unit: 'mm', min: 4, max: 20, step: 0.01, decimals: 3 },
    { type: 'number', path: 'contact.tearFilmThickness', label: 'Tränenfilm (Scheitel)', unit: 'mm', min: 0, max: 0.5, step: 0.005, decimals: 3, hint: 'Abstand Linsenrückfläche ↔ Hornhautscheitel. Vorbereitung für Tränenlinse.' },
  ],
};

const magnifierFields: FieldGroup<OpticalElement> = {
  id: 'magnifier',
  title: 'Lupe',
  fields: [
    { type: 'toggle', path: 'magnifier.showFrame', label: 'Fassung anzeigen' },
    { type: 'toggle', path: 'magnifier.showHandle', label: 'Griff anzeigen' },
  ],
};

const prismFields: FieldGroup<OpticalElement> = {
  id: 'prism',
  title: 'Prisma',
  fields: [
    { type: 'number', path: 'prism.apexAngle', label: 'Brechender Winkel α', unit: 'deg', min: 0.5, max: 80, step: 0.5, decimals: 1 },
    { type: 'number', path: 'prism.baseSetting', label: 'Basislage (TABO)', unit: 'deg', min: 0, max: 360, step: 5, decimals: 0, hint: '0° rechts · 90° oben · 180° links · 270° unten (Blick auf das Auge)' },
    { type: 'number', path: 'prism.height', label: 'Basis → Kante', unit: 'mm', min: 5, max: 100, step: 0.5, decimals: 1 },
    { type: 'number', path: 'prism.width', label: 'Breite', unit: 'mm', min: 5, max: 100, step: 0.5, decimals: 1 },
  ],
};

const plateFields: FieldGroup<OpticalElement> = {
  id: 'plate',
  title: 'Abmessungen',
  fields: [
    { type: 'number', path: 'plate.width', label: 'Breite', unit: 'mm', min: 1, max: 200, step: 0.5, decimals: 1 },
    { type: 'number', path: 'plate.height', label: 'Höhe', unit: 'mm', min: 1, max: 200, step: 0.5, decimals: 1 },
    { type: 'number', path: 'plate.thickness', label: 'Dicke', unit: 'mm', min: 0.1, max: 100, step: 0.1, decimals: 2 },
  ],
};

const mediumFields: FieldGroup<OpticalElement> = {
  id: 'body',
  title: 'Körper',
  fields: [
    {
      type: 'select',
      path: 'body.shape',
      label: 'Grundform',
      options: [
        { value: 'box', label: 'Quader' },
        { value: 'cylinder', label: 'Zylinder' },
        { value: 'sphere', label: 'Kugel' },
      ],
    },
    { type: 'number', path: 'body.width', label: 'Breite / Ø', unit: 'mm', min: 1, max: 300, step: 0.5, decimals: 1 },
    { type: 'number', path: 'body.height', label: 'Höhe', unit: 'mm', min: 1, max: 300, step: 0.5, decimals: 1, visibleIf: (e) => e.family === 'medium' && e.body.shape === 'box' },
    { type: 'number', path: 'body.depth', label: 'Tiefe (entlang Achse)', unit: 'mm', min: 1, max: 300, step: 0.5, decimals: 1, visibleIf: (e) => e.family === 'medium' && e.body.shape !== 'sphere' },
  ],
};

/* ---------------------- Kontaktlinsen-Factory ------------------- */

function contactDraft(kind: LensKind, design: 'rigid' | 'soft'): ElementDraft {
  const rigid = design === 'rigid';
  const mediumId = rigid ? 'rgp' : 'hydrogel';
  const n = findMedium(mediumId)!.n;
  const bc = rigid ? 7.8 : 8.6;
  const t = rigid ? 0.18 : 0.1;
  const targetPower = -3;
  const R1 = frontRadiusForBackVertexPower(targetPower, n, bc, t);
  return lensDraft(
    kind,
    mediumId,
    { diameter: rigid ? 9.6 : 14.2, centerThickness: t, frontRadius: Number(R1.toFixed(3)), backRadius: bc },
    {
      contact: { design, tearFilmThickness: rigid ? 0.01 : 0.005 },
      appearance: { tint: rigid ? '#cfe4ff' : '#e6f3ff', transparency: 0.9, finish: 'clear' },
    },
  );
}

/* --------------------------- Registry --------------------------- */

export const ELEMENT_DEFINITIONS: ElementDefinition[] = [
  // LINSEN
  {
    kind: 'converging-lens',
    family: 'lens',
    label: 'Sammellinse',
    category: 'Linsen',
    description: 'Gleichseitig konvexe Linse, positive Brechkraft (≈ +10 dpt).',
    defaultDistance: 60,
    create: () => lensDraft('converging-lens', 'bk7', { diameter: 40, centerThickness: 5, frontRadius: 103.4, backRadius: -103.4 }),
    fields: [lensGeometryFields(), lensSurfaceFields()],
  },
  {
    kind: 'diverging-lens',
    family: 'lens',
    label: 'Zerstreuungslinse',
    category: 'Linsen',
    description: 'Gleichseitig konkave Linse, negative Brechkraft (≈ −10 dpt).',
    defaultDistance: 60,
    create: () => lensDraft('diverging-lens', 'bk7', { diameter: 40, centerThickness: 2, frontRadius: -103.4, backRadius: 103.4 }),
    fields: [lensGeometryFields(), lensSurfaceFields()],
  },
  {
    kind: 'plano-convex',
    family: 'lens',
    label: 'Plan-konvexe Linse',
    category: 'Linsen',
    description: 'Eine Fläche plan, eine konvex.',
    defaultDistance: 60,
    create: () => lensDraft('plano-convex', 'bk7', { diameter: 30, centerThickness: 5, frontRadius: 51.7, backRadius: 0 }),
    fields: [lensGeometryFields(), lensSurfaceFields()],
  },
  {
    kind: 'plano-concave',
    family: 'lens',
    label: 'Plan-konkave Linse',
    category: 'Linsen',
    description: 'Eine Fläche plan, eine konkav.',
    defaultDistance: 60,
    create: () => lensDraft('plano-concave', 'bk7', { diameter: 30, centerThickness: 2, frontRadius: 0, backRadius: 51.7 }),
    fields: [lensGeometryFields(), lensSurfaceFields()],
  },
  {
    kind: 'biconvex',
    family: 'lens',
    label: 'Bikonvexe Linse',
    category: 'Linsen',
    description: 'Beide Flächen konvex, frei wählbare Radien.',
    defaultDistance: 60,
    create: () => lensDraft('biconvex', 'bk7', { diameter: 36, centerThickness: 6, frontRadius: 60, backRadius: -80 }),
    fields: [lensGeometryFields(), lensSurfaceFields()],
  },
  {
    kind: 'biconcave',
    family: 'lens',
    label: 'Bikonkave Linse',
    category: 'Linsen',
    description: 'Beide Flächen konkav.',
    defaultDistance: 60,
    create: () => lensDraft('biconcave', 'bk7', { diameter: 36, centerThickness: 2, frontRadius: -60, backRadius: 80 }),
    fields: [lensGeometryFields(), lensSurfaceFields()],
  },
  {
    kind: 'custom-lens',
    family: 'lens',
    label: 'Frei definierbare Linse',
    category: 'Linsen',
    description: 'Alle Radien, Dicken, Formen und Medien frei einstellbar.',
    defaultDistance: 60,
    create: () => lensDraft('custom-lens', 'glass', { diameter: 40, centerThickness: 4, frontRadius: 150, backRadius: 300 }),
    fields: [lensGeometryFields({ outline: true }), lensSurfaceFields()],
  },
  // AUGENOPTIK
  {
    kind: 'spectacle-lens',
    family: 'lens',
    label: 'Brillenglas',
    category: 'Augenoptik',
    description: 'Meniskusglas in Formrandung, frei vor dem Auge positionierbar (HSA).',
    defaultDistance: 12,
    create: () =>
      lensDraft('spectacle-lens', 'cr39', { outline: 'oval', width: 52, height: 40, diameter: 60, centerThickness: 3.5, frontRadius: 87, backRadius: 133.3 }, {
        appearance: { tint: '#e3f0f6', transparency: 0.93, finish: 'coated' },
      }),
    fields: [lensGeometryFields({ outline: true }), lensSurfaceFields('Vorderfläche r₁ (Basiskurve)', 'Rückfläche r₂ (augenseitig)')],
  },
  {
    kind: 'contact-lens',
    family: 'lens',
    label: 'Kontaktlinse',
    category: 'Augenoptik',
    description: 'Allgemeine Kontaktlinse, sitzt direkt auf der Hornhaut.',
    defaultDistance: 0,
    placeOnCornea: true,
    create: () => contactDraft('contact-lens', 'rigid'),
    fields: [contactFields],
  },
  {
    kind: 'rigid-contact-lens',
    family: 'lens',
    label: 'Formstabile Kontaktlinse',
    category: 'Augenoptik',
    description: 'Kleiner Durchmesser (≈ 9,6 mm), Basiskurve nahe Hornhautradius.',
    defaultDistance: 0,
    placeOnCornea: true,
    create: () => contactDraft('rigid-contact-lens', 'rigid'),
    fields: [contactFields],
  },
  {
    kind: 'soft-contact-lens',
    family: 'lens',
    label: 'Weiche Kontaktlinse',
    category: 'Augenoptik',
    description: 'Großer Durchmesser (≈ 14,2 mm), überdeckt den Limbus.',
    defaultDistance: 0,
    placeOnCornea: true,
    create: () => contactDraft('soft-contact-lens', 'soft'),
    fields: [contactFields],
  },
  // WEITERE OPTIK
  {
    kind: 'prism',
    family: 'prism',
    label: 'Prisma',
    category: 'Weitere Optik',
    description: 'Keilprisma mit brechendem Winkel und Basislage.',
    defaultDistance: 30,
    create: () =>
      ({
        entityType: 'element',
        family: 'prism',
        kind: 'prism',
        medium: medium('crown'),
        appearance: glass('#e2eef5'),
        physics: {},
        prism: { apexAngle: 10, baseSetting: 270, height: 30, width: 30 },
      }) as PrismElement,
    fields: [prismFields],
  },
  {
    kind: 'plane-plate',
    family: 'plate',
    label: 'Planparallele Platte',
    category: 'Weitere Optik',
    description: 'Parallelversatz ohne Brechkraft.',
    defaultDistance: 30,
    create: () =>
      ({
        entityType: 'element',
        family: 'plate',
        kind: 'plane-plate',
        medium: medium('crown'),
        appearance: glass('#e2eef5'),
        physics: {},
        plate: { width: 40, height: 40, thickness: 5 },
      }) as PlateElement,
    fields: [plateFields],
  },
  {
    kind: 'magnifier',
    family: 'lens',
    label: 'Lupe',
    category: 'Weitere Optik',
    description: 'Bikonvexe Lupenlinse mit Fassung (≈ +20 dpt, 5×).',
    defaultDistance: 40,
    create: () =>
      lensDraft('magnifier', 'crown', { diameter: 40, centerThickness: 10, frontRadius: 52, backRadius: -52 }, { magnifier: { showFrame: true, showHandle: true } }),
    fields: [lensGeometryFields(), lensSurfaceFields(), magnifierFields],
  },
  {
    kind: 'custom-medium',
    family: 'medium',
    label: 'Frei definierbares Medium',
    category: 'Weitere Optik',
    description: 'Transparenter Körper mit frei wählbarem Brechungsindex.',
    defaultDistance: 40,
    create: () =>
      ({
        entityType: 'element',
        family: 'medium',
        kind: 'custom-medium',
        medium: medium('water'),
        appearance: { tint: '#bfe3ff', transparency: 0.85, finish: 'clear' },
        physics: {},
        body: { shape: 'box', width: 30, height: 30, depth: 20 },
      }) as MediumElement,
    fields: [mediumFields],
  },
];

const byKind = new Map(ELEMENT_DEFINITIONS.map((d) => [d.kind, d]));

export function getElementDefinition(kind: ElementKind): ElementDefinition {
  const d = byKind.get(kind);
  if (!d) throw new Error(`Unbekannte Elementart: ${kind}`);
  return d;
}

export const ELEMENT_CATEGORIES: ElementCategory[] = ['Linsen', 'Augenoptik', 'Weitere Optik'];

export const isContactLens = (e: OpticalElement): boolean =>
  e.family === 'lens' && (e.kind === 'contact-lens' || e.kind === 'rigid-contact-lens' || e.kind === 'soft-contact-lens');
