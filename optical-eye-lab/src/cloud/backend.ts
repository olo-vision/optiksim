/**
 * Schnittstelle zum Konto-Backend. Die Oberfläche kennt nur diese Schnittstelle:
 *   SupabaseBackend – echte Anmeldung/Datenbank (Produktion)
 *   MockBackend     – Nachbau im Browser (nur Tests/Entwicklung, VITE_AUTH_MODE=mock)
 */
import type { AdminAccountRow, AdminConsentRow, AdminDeclarationRow, ConsumerDeclarationInput, ConsumerDeclarationReceipt, DeclarationStatus, AdminLegalDocument, BillingInterval, CloudAccount, CloudUser, InstitutionType, LegalConsentContext, LegalDocRef, LegalDocSummary, LegalDocument, LegalDraftInput, LicensePlan, LicenseSource, LicenseStatus, RegistrationInput } from './types';

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY' | 'INITIAL_SESSION' | string;

export interface SignUpResult {
  user: CloudUser | null;
  /** true = Supabase verlangt E-Mail-Bestätigung (noch keine Sitzung) */
  needsConfirmation: boolean;
}

export interface CloudBackend {
  readonly kind: 'supabase' | 'mock';
  /** Sitzung wiederherstellen (Seitenaufruf, Neuladen) */
  getUser(): Promise<CloudUser | null>;
  onAuthChange(cb: (event: AuthEvent, user: CloudUser | null) => void): () => void;
  signUp(input: RegistrationInput, emailRedirectTo: string): Promise<SignUpResult>;
  signIn(email: string, password: string): Promise<CloudUser>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  /** Profil, Institution, Lizenz des angemeldeten Benutzers (über RLS) */
  loadAccount(user: CloudUser): Promise<CloudAccount>;
  updateProfileName(userId: string, firstName: string, lastName: string): Promise<void>;
  /** Super-Admin (serverseitig geprüft) */
  adminListAccounts(): Promise<AdminAccountRow[]>;
  adminSetLicenseStatus(licenseId: string, status: LicenseStatus): Promise<void>;
  /** Stripe Checkout (Edge Function create-checkout-session) → Weiterleitungs-URL.
   *  Übergeben werden NUR Tarif, Intervall und die IDs der bestätigten Rechtstext-Versionen –
   *  Price ID und Pflicht-Zustimmungen bestimmt/prüft der Server. */
  startCheckout(plan: LicensePlan, interval: BillingInterval, consentDocumentIds: string[]): Promise<string>;
  /** Kostenlose Demo starten (RPC start_demo, serverseitig geprüft) */
  startDemo(consentDocumentIds: string[]): Promise<{ expiresAt: string; serverNow: string }>;
  /** Zu bestätigende Rechtstexte (aktuelle Versionen) für Kontext und Kundentyp */
  requiredLegalDocuments(context: LegalConsentContext, customerType: InstitutionType): Promise<LegalDocRef[]>;
  /** Veröffentlichtes Dokument in genau dieser Version (Entwürfe nie) */
  getLegalDocument(id: string): Promise<LegalDocument | null>;
  /** IDs der Dokumentversionen, denen der angemeldete Benutzer bereits zugestimmt hat (RLS: nur eigene) */
  myConsentedDocumentIds(): Promise<string[]>;
  /** Aktive Rechtstexte (Fußzeile, Übersicht) */
  publishedLegalDocuments(): Promise<LegalDocSummary[]>;
  /** Super-Admin: Vertragscenter */
  adminLegalList(): Promise<AdminLegalDocument[]>;
  adminLegalSaveDraft(input: LegalDraftInput): Promise<string>;
  adminLegalActivate(id: string): Promise<void>;
  adminLegalArchive(id: string): Promise<void>;
  adminLegalDeleteDraft(id: string): Promise<void>;
  adminListConsents(institutionId: string): Promise<AdminConsentRow[]>;
  /** Stripe Customer Portal der eigenen Institution (Edge Function create-customer-portal) → URL */
  openCustomerPortal(): Promise<string>;
  /** „Verträge hier kündigen“ / „Vertrag widerrufen“ – ohne Anmeldung (Edge Function consumer-request).
   *  Die Antwort verrät nicht, ob zur E-Mail-Adresse ein Konto existiert. */
  submitConsumerDeclaration(input: ConsumerDeclarationInput): Promise<ConsumerDeclarationReceipt>;
  /** Super-Admin: eingegangene Kündigungen und Widerrufe */
  adminListDeclarations(): Promise<AdminDeclarationRow[]>;
  adminSetDeclarationStatus(id: string, status: Extract<DeclarationStatus, 'needs_review' | 'done'>): Promise<void>;
  /** Super-Admin: Lizenz wieder an Stripe übergeben bzw. als Sonderlizenz markieren */
  adminSetLicenseSource(licenseId: string, source: LicenseSource): Promise<void>;
}
