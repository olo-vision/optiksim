/**
 * Supabase-Implementierung. Verwendet ausschließlich den Publishable/anon Key; alle Daten sind
 * durch Row Level Security geschützt (supabase/migrations). Die Sitzung wird von supabase-js im
 * localStorage gehalten und automatisch erneuert.
 */
import { createClient, type SupabaseClient, type User as SbUser } from '@supabase/supabase-js';
import type { CloudBackend } from './backend';
import { translateError } from './errors';
import { SECURE_EMAIL_CHANGE } from './config';
import { emailChangeResultFrom } from './emailChange';
import { publicLegalText } from './legal';
import { registrationMetadata, validateRegistration } from './validation';
import type { AccountLifecycleRow, AccountOverview, CloudSimulationFull, CloudSimulationPatch, CloudSimulationRow, CloudTemplateRow, NewCloudSimulation, AdminAccountRow, AdminConsentRow, AdminDeclarationRow, ConsumerDeclarationInput, ConsumerDeclarationReceipt, AdminLegalDocument, BillingInterval, BillingStatus, CloudAccount, CloudInstitution, CloudLicense, CloudProfile, CloudUser, EmailChangeResult, InstitutionType, LegalConsentContext, LegalDocRef, LegalDocSummary, LegalDocument, LegalDraftInput, LicensePlan, LicenseSource, LicenseStatus, SubscriptionStatus } from './types';
import { CloudError } from './types';

const toUser = (u: SbUser | null | undefined): CloudUser | null =>
  u ? { id: u.id, email: u.email ?? '', pendingEmail: u.new_email ?? null, emailChangeSentAt: u.email_change_sent_at ?? null } : null;

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
  accountStatus: r.account_status === 'closed' ? 'closed' : 'active',
  closedAt: r.closed_at ? String(r.closed_at) : null,
  deletionDueAt: r.deletion_due_at ? String(r.deletion_due_at) : null,
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

/** Kundenseitige Zustimmungstexte – Prüfhinweise entfernt (der Server liefert sie bereits ohne; zweite Sicherung) */
export const mapLegalRef = (r: Row): LegalDocRef => ({
  id: String(r.id),
  type: r.type as LegalDocRef['type'],
  audience: r.audience as LegalDocRef['audience'],
  version: String(r.version),
  title: publicLegalText(String(r.title ?? '')),
  checkboxLabel: publicLegalText(s(r.checkbox_label)),
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

export const toPublicLegalDoc = (d: LegalDocument): LegalDocument => ({ ...d, title: publicLegalText(d.title), content: publicLegalText(d.content) });

/** Fehlermeldung einer Edge Function (JSON { error }) lesen – ohne technische Details */
async function functionError(error: unknown, fallback: string): Promise<CloudError> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } })?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = (await ctx.json()) as { error?: unknown; code?: unknown; field?: unknown } | null;
      if (body && typeof body.error === 'string') return new CloudError(body.error, typeof body.field === 'string' ? body.field : undefined, typeof body.code === 'string' ? body.code : undefined);
    }
  } catch {
    /* Rückfall */
  }
  return new CloudError(fallback);
}


/* ------------------------------ Cloud-Inhalte (0.10.0) ------------------------------ */

/** Spalten für Listen (ohne Dokument und Vorschaubild – klein und schnell) */
const SIM_LIST_COLUMNS =
  'id, owner_user_id, institution_id, visibility, name, description, category, tags, favorite, archived, template_id, module_id, summary, schema_version, doc_revision, has_thumbnail, created_at, updated_at, last_opened_at';

export const mapSimRow = (r: Row): CloudSimulationRow => ({
  id: String(r.id),
  ownerUserId: String(r.owner_user_id),
  institutionId: String(r.institution_id),
  visibility: r.visibility === 'institution' ? 'institution' : 'private',
  name: String(r.name ?? ''),
  description: String(r.description ?? ''),
  category: String(r.category ?? 'other'),
  tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
  favorite: r.favorite === true,
  archived: r.archived === true,
  templateId: r.template_id ? String(r.template_id) : null,
  moduleId: r.module_id ? String(r.module_id) : null,
  summary: r.summary ?? {},
  schemaVersion: Number(r.schema_version ?? 1),
  docRevision: Number(r.doc_revision ?? 1),
  hasThumbnail: r.has_thumbnail === true,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  lastOpenedAt: r.last_opened_at ? String(r.last_opened_at) : null,
});

/** Änderung → Tabellenspalten (nur übergebene Felder) */
export function simPatchRow(p: CloudSimulationPatch): Row {
  const row: Row = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined) row[k] = v;
  };
  set('name', p.name);
  set('description', p.description);
  set('category', p.category);
  set('tags', p.tags);
  set('favorite', p.favorite);
  set('archived', p.archived);
  set('template_id', p.templateId);
  set('module_id', p.moduleId);
  set('summary', p.summary);
  set('schema_version', p.schemaVersion);
  set('doc', p.doc);
  set('last_opened_at', p.lastOpenedAt);
  if (p.thumbnail !== undefined) {
    row.thumbnail = p.thumbnail;
    row.has_thumbnail = !!p.thumbnail;
  }
  return row;
}

const mapOverview = (r: Row): AccountOverview => ({
  accountStatus: r.account_status === 'closed' ? 'closed' : 'active',
  closedAt: r.closed_at ? String(r.closed_at) : null,
  deletionDueAt: r.deletion_due_at ? String(r.deletion_due_at) : null,
  simulations: Number(r.simulations ?? 0),
  templates: Number(r.templates ?? 0),
  liveSubscription: r.live_subscription === true,
  subscriptionStatus: r.subscription_status ? String(r.subscription_status) : null,
  cancelAtPeriodEnd: r.cancel_at_period_end === true,
  currentPeriodEnd: r.current_period_end ? String(r.current_period_end) : null,
  canClose: r.can_close === true,
  canDelete: r.can_delete === true,
});

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

  /** Abmelden nur auf DIESEM Gerät (andere Geräte bleiben angemeldet) */
  async signOut() {
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    if (error) throw translateError(error);
  }

  async currentUserId() {
    const { data } = await this.client.auth.getSession();
    return data.session?.user?.id ?? null;
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
    if (error) throw await functionError(error, 'Die Zahlungsseite konnte nicht geöffnet werden. Bitte versuchen Sie es später erneut.');
    const url = (data as { url?: string } | null)?.url;
    if (!url || !/^https:\/\//.test(url)) throw new CloudError('Die Zahlungsseite konnte nicht geöffnet werden.');
    return url;
  }

  async submitConsumerDeclaration(input: ConsumerDeclarationInput): Promise<ConsumerDeclarationReceipt> {
    const { data, error } = await this.client.functions.invoke('consumer-request', {
      body: { kind: input.kind, cancellationType: input.cancellationType, name: input.name, email: input.email, contract: input.contract ?? '', reason: input.reason ?? '', website: input.website ?? '' },
    });
    if (error) throw await functionError(error, 'Ihre Erklärung konnte gerade nicht übermittelt werden. Bitte senden Sie sie per E-Mail an info@olo-vision.de.');
    const r = (data ?? {}) as Row;
    return { id: r.id ? String(r.id) : null, receivedAt: String(r.receivedAt ?? new Date().toISOString()), confirmationSent: r.confirmationSent === true };
  }

  async adminListDeclarations(): Promise<AdminDeclarationRow[]> {
    const { data, error } = await this.client.rpc('admin_list_declarations');
    if (error) throw translateError(error);
    return ((data ?? []) as Row[]).map((r) => {
      const result = (r.result ?? {}) as Row;
      return {
        id: String(r.id),
        kind: r.kind as AdminDeclarationRow['kind'],
        cancellationType: (r.cancellation_type as AdminDeclarationRow['cancellationType']) ?? null,
        name: String(r.name ?? ''),
        email: String(r.email ?? ''),
        contractDetails: s(r.contract_details),
        reason: s(r.reason),
        customerType: (r.customer_type as AdminDeclarationRow['customerType']) ?? null,
        institutionName: s(r.institution_name),
        stripeSubscriptionId: s(r.stripe_subscription_id),
        status: r.status as AdminDeclarationRow['status'],
        cancelAt: s(result.cancel_at),
        unmatched: result.unmatched === true,
        confirmationSentAt: s(r.confirmation_sent_at),
        notifiedAt: s(r.notified_at),
        handledAt: s(r.handled_at),
        receivedAt: String(r.received_at),
      };
    });
  }

  async adminSetDeclarationStatus(id: string, status: 'needs_review' | 'done') {
    const { error } = await this.client.rpc('admin_set_declaration_status', { p_id: id, p_status: status });
    if (error) throw translateError(error);
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
    // öffentliche Fassung: Prüfhinweise entfernt (Server liefert sie bereits ohne; zweite Sicherung)
    return row ? toPublicLegalDoc(mapLegalDoc(row)) : null;
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

  async adminLegalActivate(id: string, opts?: { acknowledgeReview?: boolean }) {
    const { error } = await this.client.rpc('admin_legal_activate', { p_id: id, p_acknowledge_review: opts?.acknowledgeReview === true });
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

  /* ------------------------------ Cloud-Inhalte (0.10.0) ------------------------------ */

  private async sessionUser(): Promise<{ id: string; email: string }> {
    const { data } = await this.client.auth.getSession();
    const u = data.session?.user;
    if (!u) throw new CloudError('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.', undefined, 'session');
    return { id: u.id, email: u.email ?? '' };
  }

  async listSimulations(): Promise<CloudSimulationRow[]> {
    const { data, error } = await this.client.from('user_simulations').select(SIM_LIST_COLUMNS).order('updated_at', { ascending: false });
    if (error) throw translateError(error);
    return ((data ?? []) as Row[]).map(mapSimRow);
  }

  async getSimulation(id: string): Promise<CloudSimulationFull | null> {
    const { data, error } = await this.client.from('user_simulations').select(`${SIM_LIST_COLUMNS}, doc`).eq('id', id).maybeSingle();
    if (error) throw translateError(error);
    return data ? { ...mapSimRow(data as Row), doc: (data as Row).doc } : null;
  }

  async insertSimulation(sim: NewCloudSimulation): Promise<CloudSimulationRow> {
    const row = {
      id: sim.id,
      ...simPatchRow(sim),
      created_at: sim.createdAt,
      updated_at: sim.updatedAt,
      origin: sim.origin ?? null,
      // Besitzer und Institution setzt der Server (Trigger); Platzhalter erfüllen nur die Pflichtspalten
      institution_id: '00000000-0000-0000-0000-000000000000',
    };
    const { data, error } = await this.client.from('user_simulations').insert(row).select(SIM_LIST_COLUMNS).single();
    if (error) {
      if (error.code === '23505') throw new CloudError('Diese Simulation existiert bereits.', undefined, 'exists');
      throw translateError(error);
    }
    return mapSimRow(data as Row);
  }

  async updateSimulation(id: string, patch: CloudSimulationPatch, expectedRevision?: number | null): Promise<CloudSimulationRow | null> {
    let q = this.client.from('user_simulations').update(simPatchRow(patch)).eq('id', id);
    if (expectedRevision != null) q = q.eq('doc_revision', expectedRevision);
    const { data, error } = await q.select(SIM_LIST_COLUMNS);
    if (error) throw translateError(error);
    const rows = (data ?? []) as Row[];
    return rows.length ? mapSimRow(rows[0]) : null;
  }

  async deleteSimulation(id: string) {
    const { error } = await this.client.from('user_simulations').delete().eq('id', id);
    if (error) throw translateError(error);
  }

  async getSimulationThumbnail(id: string) {
    const { data, error } = await this.client.from('user_simulations').select('thumbnail').eq('id', id).maybeSingle();
    if (error) throw translateError(error);
    return (data as Row | null)?.thumbnail ? String((data as Row).thumbnail) : null;
  }

  async listTemplates(): Promise<CloudTemplateRow[]> {
    const { data, error } = await this.client.from('user_templates').select('id, owner_user_id, visibility, name, description, category, tags, doc, created_at').order('created_at');
    if (error) throw translateError(error);
    return ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      ownerUserId: String(r.owner_user_id),
      visibility: r.visibility === 'institution' ? 'institution' : 'private',
      name: String(r.name ?? ''),
      description: String(r.description ?? ''),
      category: String(r.category ?? 'other'),
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
      doc: r.doc,
      createdAt: String(r.created_at),
    }));
  }

  async saveTemplate(t: Omit<CloudTemplateRow, 'ownerUserId'>) {
    const row = { id: t.id, visibility: t.visibility, name: t.name, description: t.description, category: t.category, tags: t.tags, doc: t.doc, created_at: t.createdAt, institution_id: '00000000-0000-0000-0000-000000000000' };
    const { error } = await this.client.from('user_templates').upsert(row, { onConflict: 'id' });
    if (error) throw translateError(error);
  }

  async deleteTemplate(id: string) {
    const { error } = await this.client.from('user_templates').delete().eq('id', id);
    if (error) throw translateError(error);
  }

  async getPreferences() {
    const { data, error } = await this.client.from('user_preferences').select('prefs').maybeSingle();
    if (error) throw translateError(error);
    return ((data as Row | null)?.prefs as Record<string, unknown> | undefined) ?? null;
  }

  async savePreferences(prefs: Record<string, unknown>) {
    const u = await this.sessionUser();
    const { error } = await this.client.from('user_preferences').upsert({ user_id: u.id, prefs }, { onConflict: 'user_id' });
    if (error) throw translateError(error);
  }

  /* ------------------------------------ Konto (0.10.0) ------------------------------------ */

  async accountOverview(): Promise<AccountOverview> {
    const { data, error } = await this.client.rpc('my_account_overview');
    if (error) throw translateError(error);
    return mapOverview((data ?? {}) as Row);
  }

  async closeAccount(): Promise<AccountOverview> {
    const { data, error } = await this.client.rpc('close_my_account');
    if (error) throw translateError(error);
    return mapOverview((data ?? {}) as Row);
  }

  async reopenAccount(): Promise<AccountOverview> {
    const { data, error } = await this.client.rpc('reopen_my_account');
    if (error) throw translateError(error);
    return mapOverview((data ?? {}) as Row);
  }

  async reauthenticate(password: string) {
    const u = await this.sessionUser();
    const { error } = await this.client.auth.signInWithPassword({ email: u.email, password });
    if (error) {
      const e = translateError(error);
      throw e.code === 'invalid_credentials' || e.field === 'password' ? new CloudError('Das aktuelle Passwort ist nicht korrekt.', 'password', 'invalid_credentials') : e;
    }
  }

  async changeEmail(newEmail: string, redirectTo: string): Promise<EmailChangeResult> {
    const email = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new CloudError('Bitte geben Sie eine gültige E-Mail-Adresse ein.', 'email');
    const before = await this.sessionUser();
    if (before.email.toLowerCase() === email) throw new CloudError('Die neue E-Mail-Adresse entspricht der bisherigen.', 'email');
    const startedAt = Date.now();
    const { data, error } = await this.client.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
    if (error) throw translateError(error);
    // Erfolg nur, wenn Supabase die Änderung tatsächlich angenommen hat (new_email + email_change_sent_at bzw. sofort geändert)
    return emailChangeResultFrom(email, data.user, before.email, SECURE_EMAIL_CHANGE, startedAt);
  }

  async resendEmailChange(redirectTo: string): Promise<EmailChangeResult> {
    // aktuellen Stand vom Server (nicht aus dem lokalen Sitzungsspeicher)
    const { data: cur, error: curErr } = await this.client.auth.getUser();
    if (curErr || !cur.user) throw translateError(curErr ?? new Error('Auth session missing'));
    const pending = cur.user.new_email;
    if (!pending) throw new CloudError('Es ist keine Änderung der E-Mail-Adresse offen.', undefined, 'no_pending_email');
    const startedAt = Date.now();
    const { error } = await this.client.auth.resend({ type: 'email_change', email: pending, options: { emailRedirectTo: redirectTo } });
    if (error) throw translateError(error);
    const { data } = await this.client.auth.getUser();
    return emailChangeResultFrom(pending, data.user ?? cur.user, cur.user.email ?? '', SECURE_EMAIL_CHANGE, startedAt);
  }

  async changePassword(currentPassword: string, newPassword: string) {
    await this.reauthenticate(currentPassword);
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    if (error) throw translateError(error);
  }

  async deleteAccount(confirm: string, targetUserId?: string) {
    const { error } = await this.client.functions.invoke('delete-account', { body: { confirm, ...(targetUserId ? { targetUserId } : {}) } });
    if (error) throw await functionError(error, 'Die Löschung konnte gerade nicht abgeschlossen werden. Bitte versuchen Sie es erneut.');
  }

  async adminAccountLifecycle(): Promise<AccountLifecycleRow[]> {
    const { data, error } = await this.client.rpc('admin_account_lifecycle');
    if (error) throw translateError(error);
    const str = (v: unknown) => (v == null ? null : String(v));
    return ((data ?? []) as Row[]).map((r) => ({
      category: r.category as AccountLifecycleRow['category'],
      userId: String(r.user_id),
      email: String(r.email ?? ''),
      firstName: String(r.first_name ?? ''),
      lastName: String(r.last_name ?? ''),
      institutionName: String(r.institution_name ?? ''),
      licenseStatus: str(r.license_status),
      licenseSource: str(r.license_source),
      licenseValidUntil: str(r.license_valid_until),
      closedAt: str(r.closed_at),
      deletionDueAt: str(r.deletion_due_at),
      deletionReminderSentAt: str(r.deletion_reminder_sent_at),
      deletionRequestedAt: str(r.deletion_requested_at),
      deletionRequestNote: str(r.deletion_request_note),
      simulations: Number(r.simulations ?? 0),
      lastSignInAt: str(r.last_sign_in_at),
    }));
  }

  async adminRequestDeletionByEmail(email: string, note?: string | null) {
    const { data, error } = await this.client.rpc('admin_request_deletion_by_email', { p_email: email, p_note: note ?? null });
    if (error) throw translateError(error);
    return String(data);
  }

  async adminSetDeletionRequest(userId: string, requested: boolean, note?: string | null) {
    const { error } = await this.client.rpc('admin_set_deletion_request', { p_user: userId, p_requested: requested, p_note: note ?? null });
    if (error) throw translateError(error);
  }

  async openCustomerPortal() {
    const { data, error } = await this.client.functions.invoke('create-customer-portal', { body: {} });
    if (error) throw await functionError(error, 'Die Abo-Verwaltung ist gerade nicht erreichbar. Bitte versuchen Sie es später erneut.');
    const url = (data as { url?: string } | null)?.url;
    if (!url || !/^https:\/\//.test(url)) throw new CloudError('Die Abo-Verwaltung konnte nicht geöffnet werden.');
    return url;
  }
}
