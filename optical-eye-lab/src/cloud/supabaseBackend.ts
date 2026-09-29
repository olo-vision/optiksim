/**
 * Supabase-Implementierung. Verwendet ausschließlich den Publishable/anon Key; alle Daten sind
 * durch Row Level Security geschützt (supabase/migrations). Die Sitzung wird von supabase-js im
 * localStorage gehalten und automatisch erneuert.
 */
import { createClient, type SupabaseClient, type User as SbUser } from '@supabase/supabase-js';
import type { CloudBackend } from './backend';
import { translateError } from './errors';
import { registrationMetadata, validateRegistration } from './validation';
import type { AdminAccountRow, AdminConsentRow, AdminLegalDocument, BillingInterval, BillingStatus, CloudAccount, CloudInstitution, CloudLicense, CloudProfile, CloudUser, InstitutionType, LegalConsentContext, LegalDocRef, LegalDocSummary, LegalDocument, LegalDraftInput, LicensePlan, LicenseSource, LicenseStatus, SubscriptionStatus } from './types';
import { CloudError } from './types';

const toUser = (u: SbUser | null | undefined): CloudUser | null => (u ? { id: u.id, email: u.email ?? '' } : null);

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

export const mapProfile = (r: Row): CloudProfile => ({
  id: String(r.id),
  userId: String(r.user_id),
  institutionId: String(r.institution_id),
  firstName: String(r.first_name ?? ''),
  lastName: String(r.last_name ?? ''),
  email: String(r.email ?? ''),
  role: r.role as CloudProfile['role'],
  createdAt: String(r.created_at ?? ''),
});
export const mapInstitution = (r: Row): CloudInstitution => ({
  id: String(r.id),
  type: r.type as CloudInstitution['type'],
  name: String(r.name ?? ''),
  contactName: s(r.contact_name),
  addressLine1: s(r.address_line_1),
  addressLine2: s(r.address_line_2),
  postalCode: s(r.postal_code),
  city: s(r.city),
  country: String(r.country ?? 'DE'),
  vatId: s(r.vat_id),
  contactPosition: s(r.contact_position),
});
export const mapLicense = (r: Row): CloudLicense => ({
  id: String(r.id),
  institutionId: String(r.institution_id),
  plan: r.plan as CloudLicense['plan'],
  status: r.status as CloudLicense['status'],
  validFrom: s(r.valid_from),
  validUntil: s(r.valid_until),
  maxLocations: Number(r.max_locations ?? 1),
  source: (r.source as LicenseSource | undefined) ?? 'stripe',
  gracePeriodUntil: s(r.grace_period_until),
});
export const mapBilling = (r: Row): BillingStatus => ({
  subscriptionStatus: (r.subscription_status as SubscriptionStatus | null) ?? null,
  currentPeriodEnd: s(r.current_period_end),
  cancelAtPeriodEnd: r.cancel_at_period_end === true,
  cancelAt: s(r.cancel_at),
  hasCustomer: r.has_customer === true,
  canManage: r.can_manage === true,
  billingInterval: (r.billing_interval as BillingInterval | null) ?? null,
  demoUsed: r.demo_used === true,
  demoStartedAt: s(r.demo_started_at),
  demoExpiresAt: s(r.demo_expires_at),
  hasAccess: r.has_access === true,
  serverNow: s(r.server_now),
});

export const mapLegalRef = (r: Row): LegalDocRef => ({
  id: String(r.id),
  type: r.type as LegalDocRef['type'],
  audience: r.audience as LegalDocRef['audience'],
  version: String(r.version),
  title: String(r.title ?? ''),
  checkboxLabel: s(r.checkbox_label),
  consentType: (r.consent_type as LegalDocRef['consentType']) ?? null,
  required: r.required === true,
});

export const mapLegalDoc = (r: Row): LegalDocument => ({
  id: String(r.id),
  type: r.type as LegalDocument['type'],
  audience: r.audience as LegalDocument['audience'],
  version: String(r.version),
  title: String(r.title ?? ''),
  content: String(r.content ?? ''),
  status: r.status as LegalDocument['status'],
  effectiveFrom: s(r.effective_from),
  publishedAt: s(r.published_at),
  archivedAt: s(r.archived_at),
  contentHash: s(r.content_hash),
});

/** Fehlermeldung einer Edge Function (JSON { error }) lesen – ohne technische Details */
async function functionError(error: unknown, fallback: string): Promise<CloudError> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } })?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = (await ctx.json()) as { error?: unknown; code?: unknown } | null;
      if (body && typeof body.error === 'string') return new CloudError(body.error, undefined, typeof body.code === 'string' ? body.code : undefined);
    }
  } catch {
    /* Rückfall */
  }
  return new CloudError(fallback);
}

export class SupabaseBackend implements CloudBackend {
  readonly kind = 'supabase' as const;
  readonly client: SupabaseClient;

  constructor(url: string, key: string, client?: SupabaseClient) {
    this.client = client ?? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'olo-lab3d-auth' } });
  }

  async getUser() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw translateError(error);
    return toUser(data.session?.user);
  }

  onAuthChange(cb: (event: string, user: CloudUser | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((event, session) => cb(event, toUser(session?.user)));
    return () => data.subscription.unsubscribe();
  }

  async signUp(input: Parameters<CloudBackend['signUp']>[0], emailRedirectTo: string) {
    validateRegistration(input);
    const { data, error } = await this.client.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { data: registrationMetadata(input), emailRedirectTo },
    });
    if (error) throw translateError(error);
    // Supabase meldet bei bereits existierender (bestätigter) Adresse aus Datenschutzgründen einen Benutzer ohne Identitäten
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new CloudError('Für diese E-Mail-Adresse existiert bereits ein Konto.', 'email');
    }
    return { user: toUser(data.user), needsConfirmation: !data.session };
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw translateError(error);
    return toUser(data.user)!;
  }

  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error) throw translateError(error);
  }

  async requestPasswordReset(email: string, redirectTo: string) {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error) throw translateError(error);
  }

  async updatePassword(password: string) {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw translateError(error);
  }

  async loadAccount(user: CloudUser): Promise<CloudAccount> {
    const prof = await this.client.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
    if (prof.error) throw translateError(prof.error);
    const profile = prof.data ? mapProfile(prof.data) : null;
    let institution: CloudInstitution | null = null;
    let license: CloudLicense | null = null;
    if (profile) {
      const [inst, lic] = await Promise.all([
        this.client.from('institutions').select('*').eq('id', profile.institutionId).maybeSingle(),
        this.client.from('licenses').select('*').eq('institution_id', profile.institutionId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (inst.error) throw translateError(inst.error);
      if (lic.error) throw translateError(lic.error);
      institution = inst.data ? mapInstitution(inst.data) : null;
      license = lic.data ? mapLicense(lic.data) : null;
    }
    // Abo-Übersicht (Phase 7). Fehlt die Funktion noch (Migration nicht eingespielt), bleibt die Anmeldung möglich.
    let billing: BillingStatus | null = null;
    if (profile) {
      const b = await this.client.rpc('my_billing_status');
      if (!b.error) {
        const row = Array.isArray(b.data) ? (b.data[0] as Row | undefined) : (b.data as Row | null);
        billing = row ? mapBilling(row) : null;
      }
    }
    return { userId: user.id, email: user.email, profile, institution, license, billing };
  }

  async updateProfileName(userId: string, firstName: string, lastName: string) {
    const { error } = await this.client.from('profiles').update({ first_name: firstName.trim(), last_name: lastName.trim() }).eq('user_id', userId);
    if (error) throw translateError(error);
  }

  async adminListAccounts(): Promise<AdminAccountRow[]> {
    const { data, error } = await this.client.rpc('admin_list_accounts');
    if (error) throw translateError(error);
    return ((data ?? []) as Row[]).map((r) => ({
      institutionId: String(r.institution_id),
      institutionName: String(r.institution_name ?? ''),
      institutionType: r.institution_type as AdminAccountRow['institutionType'],
      email: String(r.email ?? ''),
      firstName: String(r.first_name ?? ''),
      lastName: String(r.last_name ?? ''),
      role: r.role as AdminAccountRow['role'],
      licenseId: s(r.license_id),
      licensePlan: (r.license_plan as LicensePlan) ?? null,
      licenseStatus: (r.license_status as LicenseStatus) ?? null,
      licenseSource: (r.license_source as LicenseSource) ?? null,
      validUntil: s(r.valid_until),
      gracePeriodUntil: s(r.grace_period_until),
      subscriptionStatus: (r.subscription_status as SubscriptionStatus) ?? null,
      stripeCustomerId: s(r.stripe_customer_id),
      stripeSubscriptionId: s(r.stripe_subscription_id),
      stripePriceId: s(r.stripe_price_id),
      currentPeriodEnd: s(r.current_period_end),
      cancelAtPeriodEnd: r.cancel_at_period_end === true,
      vatId: s(r.vat_id),
      billingInterval: (r.billing_interval as BillingInterval | null) ?? null,
      demoUsed: r.demo_used === true,
      demoStartedAt: s(r.demo_started_at),
      demoExpiresAt: s(r.demo_expires_at),
      consentCount: Number(r.consent_count ?? 0),
      lastConsentAt: s(r.last_consent_at),
      consentSummary: Array.isArray(r.consent_summary) ? (r.consent_summary as Row[]).map((x) => ({ type: x.type as LegalDocRef['type'], version: String(x.version), acceptedAt: String(x.accepted_at) })) : [],
      registeredAt: String(r.registered_at ?? ''),
    }));
  }

  async adminSetLicenseStatus(licenseId: string, status: LicenseStatus) {
    const { error } = await this.client.rpc('admin_set_license_status', { p_license_id: licenseId, p_status: status });
    if (error) throw translateError(error);
  }

  async adminSetLicenseSource(licenseId: string, source: LicenseSource) {
    const { error } = await this.client.rpc('admin_set_license_source', { p_license_id: licenseId, p_source: source });
    if (error) throw translateError(error);
  }

  async startCheckout(plan: LicensePlan, interval: BillingInterval, consentDocumentIds: string[]) {
    // nur interner Tarif + Intervall + bestätigte Dokument-IDs – Price ID, Kunde, Institution und Pflicht-
    // Zustimmungen bestimmt/prüft die Edge Function
    const { data, error } = await this.client.functions.invoke('create-checkout-session', { body: { plan, interval, consents: consentDocumentIds } });
    if (error) throw await functionError(error, 'Die Zahlungsseite konnte nicht geöffnet werden. Bitte versuche es später erneut.');
    const url = (data as { url?: string } | null)?.url;
    if (!url || !/^https:\/\//.test(url)) throw new CloudError('Die Zahlungsseite konnte nicht geöffnet werden.');
    return url;
  }

  async startDemo(consentDocumentIds: string[]) {
    const { data, error } = await this.client.rpc('start_demo', { p_document_ids: consentDocumentIds });
    if (error) throw translateError(error);
    const r = (data ?? {}) as Row;
    return { expiresAt: String(r.expires_at), serverNow: String(r.server_now) };
  }

  async requiredLegalDocuments(context: LegalConsentContext, customerType: InstitutionType) {
    const { data, error } = await this.client.rpc('legal_required_documents', { p_context: context, p_customer_type: customerType });
    if (error) throw translateError(error);
    return ((data ?? []) as Row[]).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)).map(mapLegalRef);
  }

  async getLegalDocument(id: string) {
    const { data, error } = await this.client.rpc('legal_document', { p_id: id });
    if (error) throw translateError(error);
    const row = Array.isArray(data) ? (data[0] as Row | undefined) : (data as Row | null);
    return row ? mapLegalDoc(row) : null;
  }

  async myConsentedDocumentIds() {
    const { data, error } = await this.client.from('legal_consents').select('document_id');
    if (error) return [];
    return [...new Set(((data ?? []) as Row[]).map((r) => String(r.document_id)))];
  }

  async publishedLegalDocuments(): Promise<LegalDocSummary[]> {
    const { data, error } = await this.client.rpc('legal_published_documents');
    if (error) throw translateError(error);
    return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), type: r.type as LegalDocSummary['type'], audience: r.audience as LegalDocSummary['audience'], version: String(r.version), title: String(r.title ?? ''), effectiveFrom: s(r.effective_from) }));
  }

  async adminLegalList(): Promise<AdminLegalDocument[]> {
    const { data, error } = await this.client.rpc('admin_legal_documents');
    if (error) throw translateError(error);
    return ((data ?? []) as Row[]).map((r) => ({ ...mapLegalDoc(r), checkboxLabel: s(r.checkbox_label), createdAt: String(r.created_at ?? ''), updatedAt: String(r.updated_at ?? '') }));
  }

  async adminLegalSaveDraft(d: LegalDraftInput) {
    const { data, error } = await this.client.rpc('admin_legal_save_draft', {
      p_id: d.id,
      p_type: d.type,
      p_audience: d.audience,
      p_version: d.version,
      p_title: d.title,
      p_content: d.content,
      p_checkbox_label: d.checkboxLabel,
      p_effective_from: d.effectiveFrom,
    });
    if (error) throw translateError(error);
    return String(data);
  }

  async adminLegalActivate(id: string) {
    const { error } = await this.client.rpc('admin_legal_activate', { p_id: id });
    if (error) throw translateError(error);
  }

  async adminLegalArchive(id: string) {
    const { error } = await this.client.rpc('admin_legal_archive', { p_id: id });
    if (error) throw translateError(error);
  }

  async adminLegalDeleteDraft(id: string) {
    const { error } = await this.client.rpc('admin_legal_delete_draft', { p_id: id });
    if (error) throw translateError(error);
  }

  async adminListConsents(institutionId: string): Promise<AdminConsentRow[]> {
    const { data, error } = await this.client.rpc('admin_list_consents', { p_institution: institutionId });
    if (error) throw translateError(error);
    return ((data ?? []) as Row[]).map((r) => ({
      acceptedAt: String(r.accepted_at),
      email: s(r.email),
      customerType: r.customer_type as InstitutionType,
      documentId: String(r.document_id),
      documentType: r.document_type as AdminConsentRow['documentType'],
      documentVersion: String(r.document_version),
      documentAudience: r.document_audience as AdminConsentRow['documentAudience'],
      documentHash: String(r.document_hash ?? ''),
      consentType: r.consent_type as AdminConsentRow['consentType'],
      context: r.context as AdminConsentRow['context'],
      plan: s(r.plan),
      billingInterval: (r.billing_interval as BillingInterval | null) ?? null,
      checkoutSessionId: s(r.checkout_session_id),
      stripeSubscriptionId: s(r.stripe_subscription_id),
    }));
  }

  async openCustomerPortal() {
    const { data, error } = await this.client.functions.invoke('create-customer-portal', { body: {} });
    if (error) throw await functionError(error, 'Die Abo-Verwaltung ist gerade nicht erreichbar. Bitte versuche es später erneut.');
    const url = (data as { url?: string } | null)?.url;
    if (!url || !/^https:\/\//.test(url)) throw new CloudError('Die Abo-Verwaltung konnte nicht geöffnet werden.');
    return url;
  }
}
