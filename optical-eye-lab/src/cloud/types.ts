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

/* ------------------------------ Rechtstexte (Phase 8) ------------------------------ */

export type LegalDocType =
  | 'terms'
  | 'privacy'
  | 'withdrawal'
  | 'withdrawal_form'
  | 'license_terms'
  | 'b2b_terms'
  | 'consent_immediate_performance'
  | 'consent_withdrawal_loss'
  | 'other';
export const LEGAL_DOC_TYPES: LegalDocType[] = ['terms', 'privacy', 'withdrawal', 'withdrawal_form', 'license_terms', 'b2b_terms', 'consent_immediate_performance', 'consent_withdrawal_loss', 'other'];
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
