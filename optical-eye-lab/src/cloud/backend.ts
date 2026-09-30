/**
 * Schnittstelle zum Konto-Backend. Die Oberfläche kennt nur diese Schnittstelle:
 *   SupabaseBackend – echte Anmeldung/Datenbank (Produktion)
 *   MockBackend     – Nachbau im Browser (nur Tests/Entwicklung, VITE_AUTH_MODE=mock)
 */
import type { AccountOverview, CloudSimulationFull, CloudSimulationPatch, CloudSimulationRow, CloudTemplateRow, NewCloudSimulation, AdminAccountRow, AdminConsentRow, AdminDeclarationRow, ConsumerDeclarationInput, ConsumerDeclarationReceipt, DeclarationStatus, AdminLegalDocument, BillingInterval, CloudAccount, CloudUser, InstitutionType, LegalConsentContext, LegalDocRef, LegalDocSummary, LegalDocument, LegalDraftInput, LicensePlan, LicenseSource, LicenseStatus, RegistrationInput } from './types';

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
  /* ------------------------- Cloud-Inhalte des Kontos (0.10.0, RLS: nur eigene) ------------------------- */
  /** Simulationen ohne Dokument/Vorschaubild (Liste) */
  listSimulations(): Promise<CloudSimulationRow[]>;
  getSimulation(id: string): Promise<CloudSimulationFull | null>;
  /** Neue Simulation; CloudError code 'exists', wenn die ID bereits vergeben ist */
  insertSimulation(sim: NewCloudSimulation): Promise<CloudSimulationRow>;
  /**
   * Felder ändern. Mit expectedRevision nur, wenn die Dokument-Revision noch passt (sonst null = Konflikt
   * oder nicht mehr vorhanden). Ohne expectedRevision unbedingt.
   */
  updateSimulation(id: string, patch: CloudSimulationPatch, expectedRevision?: number | null): Promise<CloudSimulationRow | null>;
  deleteSimulation(id: string): Promise<void>;
  getSimulationThumbnail(id: string): Promise<string | null>;
  listTemplates(): Promise<CloudTemplateRow[]>;
  saveTemplate(t: Omit<CloudTemplateRow, 'ownerUserId'>): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  /** Kontobezogene Einstellungen (null = noch keine gespeichert) */
  getPreferences(): Promise<Record<string, unknown> | null>;
  savePreferences(prefs: Record<string, unknown>): Promise<void>;

  /* ------------------------------------------ Konto (0.10.0) ------------------------------------------ */
  accountOverview(): Promise<AccountOverview>;
  closeAccount(): Promise<AccountOverview>;
  reopenAccount(): Promise<AccountOverview>;
  /** Mit dem aktuellen Passwort erneut anmelden (frische Sitzung für sensible Aktionen) */
  reauthenticate(password: string): Promise<void>;
  /** E-Mail ändern: Bestätigungslink an die neue Adresse; wirksam erst nach Bestätigung */
  changeEmail(newEmail: string, redirectTo: string): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** Endgültig löschen (Edge Function delete-account); vorher reauthenticate() */
  deleteAccount(confirm: string, targetUserId?: string): Promise<void>;
  /** Super-Admin: geschlossene Konten */
  adminClosedAccounts(): Promise<Array<{ userId: string; email: string; institutionName: string; closedAt: string | null; deletionDueAt: string | null; simulations: number }>>;

  /** Super-Admin: Lizenz wieder an Stripe übergeben bzw. als Sonderlizenz markieren */
  adminSetLicenseSource(licenseId: string, source: LicenseSource): Promise<void>;
}
