/**
 * Modul-Registry – Erweiterungspunkt für spätere Fachmodule.
 *
 * Ein Modul beschreibt sich selbst (Metadaten, Status) und kann später
 * folgende Erweiterungspunkte bedienen (Schnittstelle bereits festgelegt):
 *   - zusätzliche Szenenobjekte (Untersuchungsgeräte)
 *   - Inspector-Abschnitte für bestehende Objekte
 *   - Overlays in der 3D-Szene
 *   - Berechnungen auf dem Szenendokument
 *   - Lerninhalte (Erklärung, Formel, Herleitung mit aktuellen Werten)
 *
 * Status: 'active' = nutzbar, 'preview' = nutzbar mit Einschränkungen, 'planned' = „In Entwicklung“ (deaktiviert).
 */
import type { ComponentType } from 'react';
import type { SceneDocument, SceneEntity } from '@/model/types';

export type ModuleStatus = 'planned' | 'preview' | 'active';
export type ModuleCategory = 'Optische Simulation' | 'Kontaktlinsen' | 'Untersuchungsgeräte' | 'Lernmodus';

export interface ModuleContext {
  doc: SceneDocument;
}

export interface OpticalModule {
  id: string;
  title: string;
  category: ModuleCategory;
  status: ModuleStatus;
  description: string;
  /** Optionale Erweiterungen (später) */
  inspectorSections?: Array<{ appliesTo: (e: SceneEntity) => boolean; component: ComponentType<{ entity: SceneEntity }> }>;
  sceneOverlay?: ComponentType<ModuleContext>;
  compute?: (ctx: ModuleContext) => Record<string, number>;
}

export const MODULES: OpticalModule[] = [
  { id: 'raytracing', title: 'Strahlengang', category: 'Optische Simulation', status: 'active', description: 'Geometrische Strahlverfolgung (Snellius), torische Flächen, Dispersion (Phase 4).' },
  { id: 'ametropia', title: 'Fehlsichtigkeiten', category: 'Optische Simulation', status: 'active', description: 'Myopie, Hyperopie, Astigmatismus; Akkommodation (Phase 4). Presbyopie über Alter/Akkommodationsbreite.' },
  { id: 'correction', title: 'Korrektion & HSA', category: 'Optische Simulation', status: 'active', description: 'Effektive Brechkraft, Hornhautscheitelabstand, Vollkorrektion.' },
  { id: 'patient-view', title: 'Patientensicht', category: 'Optische Simulation', status: 'active', description: 'Unschärfe aus Defokus, Zylinder und Pupille (PSF-Faltung), Visus-Schätzung.' },
  { id: 'tear-lens', title: 'Tränenlinse', category: 'Kontaktlinsen', status: 'active', description: 'Tränenfilm zwischen Kontaktlinse und Hornhaut.' },
  { id: 'fluorescein', title: 'Fluoreszeinbild', category: 'Kontaktlinsen', status: 'active', description: 'Fluoreszeinbild formstabiler Linsen aus der Tränenfilmgeometrie.' },
  { id: 'lens-fit', title: 'Linsensitz', category: 'Kontaktlinsen', status: 'preview', description: 'Zentrierung, Auflage, Randunterspülung (statisch; Lidschlag-Bewegung geplant).' },
  { id: 'retinoscope', title: 'Skiaskop', category: 'Untersuchungsgeräte', status: 'active', description: 'Strichskiaskopie mit Reflexbewegung, Neutralisation und Training.' },
  { id: 'phoropter', title: 'Messbrille / Phoropter', category: 'Untersuchungsgeräte', status: 'active', description: 'Subjektive Refraktion mit Messglas, Kreuzzylinder, Nebeln, Rot-Grün.' },
  { id: 'keratometer', title: 'Keratometer', category: 'Untersuchungsgeräte', status: 'active', description: 'Hornhautradien und Brechwerte (Inspector → Werkzeuge).' },
  { id: 'lensmeter', title: 'Scheitelbrechwertmesser', category: 'Untersuchungsgeräte', status: 'active', description: 'Scheitelbrechwert und Prisma eines Glases (Inspector → Werkzeuge).' },
  { id: 'slit-lamp', title: 'Spaltlampe', category: 'Untersuchungsgeräte', status: 'planned', description: 'Beleuchtungsarten und Spaltbild (Kobaltblau/Fluo bereits im Arbeitsbereich Kontaktlinse).' },
  { id: 'ophthalmoscope', title: 'Ophthalmoskop', category: 'Untersuchungsgeräte', status: 'planned', description: 'Direkte Ophthalmoskopie – benötigt ein Netzhautmodell.' },
  { id: 'learning', title: 'Lernmodus', category: 'Lernmodus', status: 'preview', description: 'Formel, eingesetzte Werte und Herleitung (ⓘ), Fachinfo, Trainingsfälle.' },
];

export const modulesByCategory = (c: ModuleCategory) => MODULES.filter((m) => m.category === c);
