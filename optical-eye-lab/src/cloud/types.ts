/**
 * Datenmodelle der SaaS-Schicht – spiegeln die Tabellen aus supabase/migrations (snake_case → camelCase).
 */
export type InstitutionType = 'private' | 'business' | 'education';
export type AppRole = 'super_admin' | 'institution_admin' | 'user';
export type LicensePlan = InstitutionType;
export type LicenseStatus = 'pending' | 'active' | 'past_due' | 'suspended' | 'expired' | 'cancelled';
/** Herkunft des Lizenzstatus: Stripe-Abo, manuelle Sonderlizenz (Super-Admin) oder kostenlose Demo (Phase 8) */
export type LicenseSource = 'stripe' | 'manual' | 'demo';
/** Abrechnungsintervall kostenpflichtiger Pakete (Phase 8) */
export type BillingInterval = 'monthly' | 'yearly';
export const BILLING_INTERVALS: BillingInterval[] = ['monthly', 'yearly'];
/** Stripe-Abo-Status (https://docs.stripe.com/api/subscriptions/object#subscription_object-status) */
export type SubscriptionStatus = 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';

export const INSTITUTION_TYPES: InstitutionType[] = ['private', 'business', 'education'];
export const LICENSE_STATUSES: LicenseStatus[] = ['pending', 'active', 'past_due', 'suspended', 'expired', 'cancelled'];

export interface CloudProfile {
  id: string;
  userId: string;
  institutionId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: AppRole;
  createdAt: string;
  /** 0.10.0: geschlossenes Konto (Inhalte bleiben bis deletionDueAt erhalten, Konto kann wieder geöffnet werden) */
  accountStatus?: 'active' | 'closed';
  closedAt?: string | null;
  deletionDueAt?: string | null;
  /** 0.10.1: Erinnerung vor der automatischen Löschung versendet */
  deletionReminderSentAt?: string | null;
  /** 0.10.1: Löschantrag (von der Administration erfasst) */
  deletionRequestedAt?: string | null;
  deletionRequestNote?: string | null;
}

/** Admin-Center: Konten mit besonderem Status (Lizenz abgelaufen · geschlossen · Löschung beantragt) */
export type AccountLifecycleCategory = 'license_ended' | 'closed' | 'deletion_requested';
export interface AccountLifecycleRow {
  category: AccountLifecycleCategory;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  institutionName: string;
  licenseStatus: string | null;
  licenseSource: string | null;
  licenseValidUntil: string | null;
  closedAt: string | null;
  deletionDueAt: string | null;
  deletionReminderSentAt: string | null;
  deletionRequestedAt: string | null;
  deletionRequestNote: string | null;
  simulations: number;
  lastSignInAt: string | null;
}

export interface CloudInstitution {
  id: string;
  type: InstitutionType;
  name: string;
  contactName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  /** Phase 8 – B2B */
  vatId?: string | null;
  contactPosition?: string | null;
}

export interface CloudLicense {
  id: string;
  institutionId: string;
  plan: LicensePlan;
  status: LicenseStatus;
  validFrom: string | null;
  validUntil: string | null;
  maxLocations: number;
  /** Phase 7 */
  source?: LicenseSource;
  /** Frist nach fehlgeschlagener Zahlung (status past_due) */
  gracePeriodUntil?: string | null;
}

/** Nicht-sensible Abo-Übersicht (public.my_billing_status) – keine Stripe-IDs */
export interface BillingStatus {
  subscriptionStatus: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  hasCustomer: boolean;
  /** darf „Abonnement verwalten“ öffnen (Institution-Admin mit Stripe-Kunde) */
  canManage: boolean;
  /** Phase 8 */
  billingInterval?: BillingInterval | null;
  demoUsed?: boolean;
  demoStartedAt?: string | null;
  demoExpiresAt?: string | null;
  /** serverseitig ausgewertet (has_active_license) */
  hasAccess?: boolean;
  /** Serverzeit zum Zeitpunkt der Abfrage – Grundlage aller Zeitprüfungen im Browser */
  serverNow?: string | null;
}

/* ------------------------------ Cloud-Inhalte des Kontos (0.10.0) ------------------------------ */

/** Simulation in der Datenbank (ohne Dokument und Vorschaubild – für Listen) */
export interface CloudSimulationRow {
  id: string;
  ownerUserId: string;
  institutionId: string;
  visibility: 'private' | 'institution';
  name: string;
  description: string;
  category: string;
  tags: string[];
  favorite: boolean;
  archived: boolean;
  templateId: string | null;
  moduleId: string | null;
  summary: unknown;
  schemaVersion: number;
  docRevision: number;
  hasThumbnail: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}
export interface CloudSimulationFull extends CloudSimulationRow {
  doc: unknown;
}
/** Neue Simulation (Besitzer und Institution setzt der Server) */
export interface NewCloudSimulation {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  favorite: boolean;
  archived: boolean;
  templateId: string | null;
  moduleId: string | null;
  summary: unknown;
  schemaVersion: number;
  doc: unknown;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  origin?: string | null;
}
/** Änderbare Felder (nur übergebene Felder werden geändert) */
export type CloudSimulationPatch = Partial<Omit<NewCloudSimulation, 'id' | 'createdAt' | 'updatedAt' | 'origin'>>;

export interface CloudTemplateRow {
  id: string;
  ownerUserId: string;
  visibility: 'private' | 'institution';
  name: string;
  description: string;
  category: string;
  tags: string[];
  doc: unknown;
  createdAt: string;
}

export interface AccountOverview {
  accountStatus: 'active' | 'closed';
  closedAt: string | null;
  deletionDueAt: string | null;
  simulations: number;
  templates: number;
  liveSubscription: boolean;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  canClose: boolean;
  canDelete: boolean;
}

/* ------------------------------ Kündigung / Widerruf über die Website ------------------------------ */

export type ConsumerDeclarationKind = 'cancellation' | 'withdrawal';
export interface ConsumerDeclarationInput {
  kind: ConsumerDeclarationKind;
  /** nur Kündigung: ordentlich (nächstmöglicher Zeitpunkt) oder außerordentlich (mit Grund) */
  cancellationType?: 'ordinary' | 'extraordinary';
  name: string;
  email: string;
  contract?: string;
  reason?: string;
  /** Honeypot – bleibt für Menschen leer */
  website?: string;
}
export interface ConsumerDeclarationReceipt {
  id: string | null;
  receivedAt: string;
  confirmationSent: boolean;
}
export type DeclarationStatus = 'received' | 'processed' | 'needs_review' | 'done';
export interface AdminDeclarationRow {
  id: string;
  kind: ConsumerDeclarationKind;
  cancellationType: 'ordinary' | 'extraordinary' | null;
  name: string;
  email: string;
  contractDetails: string | null;
  reason: string | null;
  customerType: InstitutionType | null;
  institutionName: string | null;
  stripeSubscriptionId: string | null;
  status: DeclarationStatus;
  cancelAt: string | null;
  unmatched: boolean;
  confirmationSentAt: string | null;
  notifiedAt: string | null;
  handledAt: string | null;
  receivedAt: string;
}

/* ------------------------------ Rechtstexte (Phase 8) ------------------------------ */

export type LegalDocType =
  | 'imprint'
  | 'terms'
  | 'privacy'
  | 'withdrawal'
  | 'withdrawal_form'
  | 'license_terms'
  | 'b2b_terms'
  | 'consent_immediate_performance'
  | 'consent_withdrawal_loss'
  | 'other';
export const LEGAL_DOC_TYPES: LegalDocType[] = ['imprint', 'terms', 'privacy', 'withdrawal', 'withdrawal_form', 'license_terms', 'b2b_terms', 'consent_immediate_performance', 'consent_withdrawal_loss', 'other'];
export type LegalAudience = 'all' | 'b2c' | 'b2b';
export type LegalDocStatus = 'draft' | 'active' | 'archived';
export type LegalConsentContext = 'registration' | 'demo' | 'checkout';
export type LegalConsentType = 'accepted' | 'acknowledged' | 'agreed';

/** Ein zu bestätigendes (oder nur verlinktes) Dokument in einem Kontext – exakt diese Version */
export interface LegalDocRef {
  id: string;
  type: LegalDocType;
  audience: LegalAudience;
  version: string;
  title: string;
  checkboxLabel: string | null;
  consentType: LegalConsentType | null;
  required: boolean;
}

export interface LegalDocument {
  id: string;
  type: LegalDocType;
  audience: LegalAudience;
  version: string;
  title: string;
  content: string;
  status: LegalDocStatus;
  effectiveFrom: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  contentHash: string | null;
}

export interface LegalDocSummary {
  id: string;
  type: LegalDocType;
  audience: LegalAudience;
  version: string;
  title: string;
  effectiveFrom: string | null;
}

export interface AdminLegalDocument extends LegalDocument {
  checkboxLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LegalDraftInput {
  id: string | null;
  type: LegalDocType;
  audience: LegalAudience;
  version: string;
  title: string;
  content: string;
  checkboxLabel: string | null;
  effectiveFrom: string | null;
}

export interface AdminConsentRow {
  acceptedAt: string;
  email: string | null;
  customerType: InstitutionType;
  documentId: string;
  documentType: LegalDocType;
  documentVersion: string;
  documentAudience: LegalAudience;
  documentHash: string;
  consentType: LegalConsentType;
  context: LegalConsentContext;
  plan: string | null;
  billingInterval: BillingInterval | null;
  checkoutSessionId: string | null;
  stripeSubscriptionId: string | null;
}

/** Alles, was die Oberfläche über das angemeldete Konto wissen muss */
export interface CloudAccount {
  userId: string;
  email: string;
  profile: CloudProfile | null;
  institution: CloudInstitution | null;
  license: CloudLicense | null;
  billing?: BillingStatus | null;
}

export interface CloudUser {
  id: string;
  email: string;
}

export interface RegistrationInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  passwordConfirm: string;
  institutionType: InstitutionType;
  institutionName?: string;
  contactName?: string;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  /** Phase 8 – B2B */
  vatId?: string;
  contactPosition?: string;
  /** IDs der angezeigten und bestätigten Rechtstext-Versionen (serverseitig geprüft) */
  consentDocumentIds?: string[];
}

export interface AdminAccountRow {
  institutionId: string;
  institutionName: string;
  institutionType: InstitutionType;
  email: string;
  firstName: string;
  lastName: string;
  role: AppRole;
  licenseId: string | null;
  licensePlan: LicensePlan | null;
  licenseStatus: LicenseStatus | null;
  licenseSource: LicenseSource | null;
  validUntil: string | null;
  gracePeriodUntil: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  registeredAt: string;
  /** Phase 8 */
  vatId?: string | null;
  billingInterval?: BillingInterval | null;
  demoUsed?: boolean;
  demoStartedAt?: string | null;
  demoExpiresAt?: string | null;
  consentCount?: number;
  lastConsentAt?: string | null;
  consentSummary?: Array<{ type: LegalDocType; version: string; acceptedAt: string }>;
}

export { ContentConflictError } from '@/platform/content';

/** Fehler mit Feldbezug für Formulare */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly field?: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}
