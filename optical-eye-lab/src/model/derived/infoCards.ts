/**
 * Kompakte Objektinformationen für Hover-Tooltip und Info-Karte.
 * Einheitliches Format, damit der spätere Lernmodus („Mathematisch erklären“)
 * an genau diese Einträge andocken kann.
 */
import type { EyeAnatomy, EyePartId, SceneEntity } from '../types';
import { formatNumber, formatPower, formatValue } from '@/core/units';
import { getElementDefinition } from '../elementRegistry';
import { computeElementOptics } from '@/engine/physics/elementOptics';
import { surfacePower } from '@/engine/physics/formulas';

export interface InfoRow {
  label: string;
  value: string;
}

export interface InfoCard {
  title: string;
  subtitle?: string;
  rows: InfoRow[];
  /** Schlüssel für den späteren Lernmodus */
  topic: string;
}

export const EYE_PART_LABELS: Record<EyePartId, string> = {
  cornea: 'Hornhaut',
  sclera: 'Lederhaut (Sklera)',
  iris: 'Regenbogenhaut (Iris)',
  pupil: 'Pupille',
  'anterior-chamber': 'Vorderkammer',
  lens: 'Augenlinse',
  vitreous: 'Glaskörper',
  retina: 'Netzhaut (Retina)',
};

export function eyePartInfo(part: EyePartId, a: EyeAnatomy): InfoCard {
  const n = (v: number) => formatNumber(v, 4);
  const mm = (v: number) => formatValue(v, 'mm', 2);
  switch (part) {
    case 'cornea':
      return {
        title: 'Hornhaut',
        subtitle: 'Cornea',
        topic: 'eye.cornea',
        rows: [
          { label: 'Brechungsindex', value: n(a.nCornea) },
          { label: 'Radius vorn', value: mm(a.corneaFrontRadius) },
          { label: 'Radius hinten', value: mm(a.corneaBackRadius) },
          { label: 'Mittendicke', value: mm(a.corneaThickness) },
          { label: 'Flächenbrechwert vorn', value: formatPower(surfacePower(1, a.nCornea, a.corneaFrontRadius)) },
        ],
      };
    case 'anterior-chamber':
      return {
        title: 'Vorderkammer',
        subtitle: 'Kammerwasser',
        topic: 'eye.anterior-chamber',
        rows: [
          { label: 'Brechungsindex', value: n(a.nAqueous) },
          { label: 'Tiefe (ab Hornhautscheitel)', value: mm(a.anteriorChamberDepth) },
        ],
      };
    case 'iris':
      return {
        title: 'Iris',
        subtitle: 'Aperturblende des Auges',
        topic: 'eye.iris',
        rows: [{ label: 'Pupillendurchmesser', value: mm(a.pupilDiameter) }],
      };
    case 'pupil':
      return {
        title: 'Pupille',
        subtitle: 'Öffnung der Iris',
        topic: 'eye.pupil',
        rows: [
          { label: 'Durchmesser', value: mm(a.pupilDiameter) },
          { label: 'Fläche', value: `${formatNumber(Math.PI * (a.pupilDiameter / 2) ** 2, 2)} mm²` },
        ],
      };
    case 'lens':
      return {
        title: 'Augenlinse',
        subtitle: 'Lens crystallina (homogen vereinfacht)',
        topic: 'eye.lens',
        rows: [
          { label: 'Brechungsindex', value: n(a.nLens) },
          { label: 'Radius vorn', value: mm(a.lensFrontRadius) },
          { label: 'Radius hinten', value: mm(a.lensBackRadius) },
          { label: 'Dicke', value: mm(a.lensThickness) },
        ],
      };
    case 'vitreous':
      return {
        title: 'Glaskörper',
        subtitle: 'Corpus vitreum',
        topic: 'eye.vitreous',
        rows: [{ label: 'Brechungsindex', value: n(a.nVitreous) }],
      };
    case 'retina':
      return {
        title: 'Netzhaut',
        subtitle: 'Retina',
        topic: 'eye.retina',
        rows: [{ label: 'Baulänge (Scheitel → Retina)', value: mm(a.axialLength) }],
      };
    case 'sclera':
      return {
        title: 'Lederhaut',
        subtitle: 'Sklera',
        topic: 'eye.sclera',
        rows: [
          { label: 'Äquatorradius', value: mm(a.globeRadius) },
          { label: 'Baulänge', value: mm(a.axialLength) },
        ],
      };
  }
}

export function entityInfo(e: SceneEntity, eyePart?: EyePartId | null): InfoCard {
  switch (e.entityType) {
    case 'eye':
      if (eyePart) return eyePartInfo(eyePart, e.anatomy);
      return {
        title: e.name,
        subtitle: 'Modellauge (Le Grand, vereinfacht)',
        topic: 'eye',
        rows: [
          { label: 'Baulänge', value: formatValue(e.anatomy.axialLength, 'mm', 2) },
          { label: 'Pupille', value: formatValue(e.anatomy.pupilDiameter, 'mm', 1) },
        ],
      };
    case 'element': {
      const def = getElementDefinition(e.kind);
      const computed = computeElementOptics(e);
      const rows: InfoRow[] = [{ label: 'Brechungsindex', value: formatNumber(e.medium.n, 4) }];
      if (e.family === 'lens') {
        rows.push({ label: 'Radius vorn', value: e.lens.frontRadius === 0 ? '∞ (plan)' : formatValue(e.lens.frontRadius, 'mm', 2) });
        rows.push({ label: 'Radius hinten', value: e.lens.backRadius === 0 ? '∞ (plan)' : formatValue(e.lens.backRadius, 'mm', 2) });
      }
      const main = computed.find((c) => c.id === 'Sv' || c.id === 'P');
      if (main) rows.push({ label: main.label, value: main.unit === 'dpt' ? formatPower(main.value) : formatValue(main.value, main.unit === 'pdpt' ? 'pdpt' : 'deg', 2) });
      return { title: e.name, subtitle: def.label, topic: `element.${e.kind}`, rows };
    }
    case 'light':
      return {
        title: e.name,
        subtitle: e.source.kind === 'parallel' ? 'Paralleles Lichtbündel' : 'Punktlichtquelle',
        topic: 'light',
        rows: [
          { label: 'Bündeldurchmesser', value: formatValue(e.source.beamDiameter, 'mm', 1) },
          { label: 'Strahlen', value: String(e.source.rayCount) },
          { label: 'Wellenlänge', value: `${formatNumber(e.source.wavelength, 1)} nm` },
        ],
      };
    case 'measure-point':
      return {
        title: e.name,
        subtitle: 'Messpunkt',
        topic: 'measure-point',
        rows: [
          {
            label: 'Position',
            value: e.transform.position.map((v) => formatNumber(v, 1)).join(' / ') + ' mm',
          },
        ],
      };
  }
}
