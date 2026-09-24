/**
 * Plattform-Datenmodelle (Phase 3).
 *
 * Strikt getrennt vom SceneDocument (= eigentliche Simulation):
 *   User · Organization · UserPreferences · SimulationMetadata · SimulationRecord · Template · Session
 * Alle Modelle sind reines JSON und enthalten eine optionale organizationId, damit später
 * Mandantenfähigkeit (Multi-Tenant) ohne Schemabruch ergänzt werden kann.
 */
import type { SceneDocument } from '@/model/types';

export type Role = 'admin' | 'trainer' | 'member' | 'guest';

export type OrganizationType = 'school' | 'master-school' | 'business' | 'university' | 'training-center' | 'industry' | 'research' | 'other';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  role: Role;
  organizationId?: string;
  /** Avatar als Data-URL (lokal) oder Farbton für Initialen */
  avatarDataUrl?: string;
  avatarColor: string;
  language: 'de' | 'en';
  /** Optional, bewusst sparsam */
  jobTitle?: string;
  trainingStatus?: string;
  department?: string;
  active: boolean;
  /** Konto aus den Demo-Daten (entfernbar) */
  isDemo?: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface Branding {
  productName: string;
  /** Akzentfarbe der Oberfläche (Hex) */
  accentColor: string;
  /** Logo der Organisation als Data-URL */
  logoDataUrl?: string;
  companyName?: string;
}

export interface Organization {
  id: string;
  name: string;
  type: OrganizationType;
  defaultRole: Role;
  /** IDs der Vorlagen, die neuen Nutzern prominent angezeigt werden */
  featuredTemplateIds: string[];
  branding: Branding;
  createdAt: string;
  /** Vorbereitet für Lizenzierung/Benutzerlimits (Phase 4+) – derzeit ohne Wirkung */
  plan?: { name: string; seatLimit?: number };
}

export type SimulationCategory =
  | 'refraction'
  | 'spectacles'
  | 'contact-lens'
  | 'astigmatism'
  | 'tear-lens'
  | 'demonstration'
  | 'training'
  | 'custom'
  | 'other';

export interface SimulationMetadata {
  id: string;
  name: string;
  description: string;
  /** Besitzer; 'legacy' = aus früherer Version übernommen (für alle sichtbar) */
  ownerId: string;
  organizationId?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  tags: string[];
  category: SimulationCategory;
  favorite: boolean;
  archived: boolean;
  /** Vorlage, aus der die Simulation entstand */
  templateId?: string;
  /** Kurzbeschreibung der Optik (abgeleitet beim Speichern) */
  summary: SimulationSummary;
  hasThumbnail: boolean;
  /** Schema-Version des gespeicherten SceneDocuments */
  schemaVersion: number;
}

export interface SimulationSummary {
  eyeRx: string;
  elementCount: number;
  elementKinds: string[];
  highlights: string[];
  modelName: string;
}

export interface SimulationRecord {
  meta: SimulationMetadata;
  doc: SceneDocument;
}

export type TemplateVisibility = 'builtin' | 'private' | 'organization';

export interface Template {
  id: string;
  name: string;
  description: string;
  category: SimulationCategory;
  tags: string[];
  visibility: TemplateVisibility;
  createdBy?: string;
  organizationId?: string;
  createdAt: string;
  /** Eingebaute Vorlagen erzeugen ihr Dokument per Code (presetId), eigene speichern es */
  presetId?: string;
  doc?: SceneDocument;
}

export interface Session {
  userId: string;
  provider: string;
  issuedAt: string;
}

export const ROLE_ORDER: Role[] = ['admin', 'trainer', 'member', 'guest'];

export const CATEGORY_LABELS: Record<SimulationCategory, string> = {
  refraction: 'Refraktion',
  spectacles: 'Brillenglas',
  'contact-lens': 'Kontaktlinse',
  astigmatism: 'Astigmatismus',
  'tear-lens': 'Tränenlinse',
  demonstration: 'Demonstration',
  training: 'Training',
  custom: 'Eigene',
  other: 'Sonstige',
};

export const ORG_TYPE_LABELS: Record<OrganizationType, string> = {
  school: 'Schule / Berufsschule',
  'master-school': 'Meisterschule',
  business: 'Augenoptikbetrieb',
  university: 'Hochschule',
  'training-center': 'Schulungszentrum',
  industry: 'Industrie / Hersteller',
  research: 'Forschung',
  other: 'Sonstige',
};
