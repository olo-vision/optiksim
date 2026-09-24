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
 * In Phase 1 ist KEIN Modul aktiv; die Einträge dienen der Planung und werden in
 * der Oberfläche ausschließlich als „In Entwicklung“ (deaktiviert) angezeigt.
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
  { id: 'raytracing', title: 'Strahlengang', category: 'Optische Simulation', status: 'preview', description: 'Geometrische Strahlverfolgung durch Elemente und Auge (Snellius).' },
  { id: 'ametropia', title: 'Fehlsichtigkeiten', category: 'Optische Simulation', status: 'planned', description: 'Myopie, Hyperopie, Astigmatismus, Presbyopie.' },
  { id: 'correction', title: 'Korrektion & HSA', category: 'Optische Simulation', status: 'planned', description: 'Effektive Brechkraft, Hornhautscheitelabstand, Vollkorrektion.' },
  { id: 'tear-lens', title: 'Tränenlinse', category: 'Kontaktlinsen', status: 'planned', description: 'Tränenfilm zwischen Kontaktlinse und Hornhaut.' },
  { id: 'fluorescein', title: 'Fluoreszeinbild', category: 'Kontaktlinsen', status: 'planned', description: 'Simulation des Fluoreszeinbildes formstabiler Linsen.' },
  { id: 'lens-fit', title: 'Linsensitz', category: 'Kontaktlinsen', status: 'planned', description: 'Zentrierung, Bewegung, Randunterspülung.' },
  { id: 'retinoscope', title: 'Skiaskop', category: 'Untersuchungsgeräte', status: 'planned', description: 'Strichskiaskopie mit Reflexbewegung.' },
  { id: 'slit-lamp', title: 'Spaltlampe', category: 'Untersuchungsgeräte', status: 'planned', description: 'Beleuchtungsarten und Spaltbild.' },
  { id: 'keratometer', title: 'Keratometer', category: 'Untersuchungsgeräte', status: 'planned', description: 'Hornhautradien und -brechwerte.' },
  { id: 'ophthalmoscope', title: 'Ophthalmoskop', category: 'Untersuchungsgeräte', status: 'planned', description: 'Direkte Ophthalmoskopie.' },
  { id: 'phoropter', title: 'Phoropter', category: 'Untersuchungsgeräte', status: 'planned', description: 'Subjektive Refraktion.' },
  { id: 'learning', title: 'Lernmodus', category: 'Lernmodus', status: 'planned', description: 'Erklärung, Formel und Herleitung mit aktuellen Simulationswerten.' },
];

export const modulesByCategory = (c: ModuleCategory) => MODULES.filter((m) => m.category === c);
