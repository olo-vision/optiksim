/**
 * Mock-Backend (nur Tests/Entwicklung: VITE_AUTH_MODE=mock).
 *
 * Bildet das Verhalten der Supabase-Struktur im Browser nach, damit Oberfläche und Abläufe ohne
 * Server geprüft werden können: Registrierung wie der Trigger handle_new_user (Institution,
 * institution_admin, Lizenz „pending“), Anmeldung, Sitzung, Passwort-Reset, Admin-Funktionen nur für
 * super_admin. Die eigentliche Sicherheit (RLS) wird separat gegen PostgreSQL getestet (tests/db).
 *
 * Testhaken (window.__oloMock): setLicenseStatus, setRole, setRequireConfirmation, confirmEmail,
 * openRecoveryLink, reset.
 *
 * Phase 7 – Stripe-Nachbau: startCheckout legt einen „laufenden Checkout“ an; der simulierte Webhook
 * aktiviert die Lizenz erst nach einer Verzögerung (wie echte Webhooks – der Success-Rücksprung allein
 * schaltet nichts frei). Lizenzregeln wie public.sync_license_for_institution() (maßgeblich ist die
 * Datenbank; tests/db/stripe.test.ts). Haken: stripeEvent, setWebhookDelay, setCheckoutOutcome.
 */
import type { AuthEvent, CloudBackend } from './backend';
import { registrationMetadata, validateRegistration } from './validation';
import {
  CloudError,
  type AdminAccountRow,
  type AdminConsentRow,
  type AdminDeclarationRow,
  type ConsumerDeclarationInput,
  type ConsumerDeclarationReceipt,
  type AdminLegalDocument,
  type AppRole,
  type BillingInterval,
  type BillingStatus,
  type CloudAccount,
  type CloudInstitution,
  type CloudLicense,
  type CloudProfile,
  type CloudUser,
  type InstitutionType,
  type LegalAudience,
  type LegalConsentContext,
  type LegalConsentType,
  type LegalDocRef,
  type LegalDocSummary,
  type LegalDocType,
  type LegalDocument,
  type LegalDraftInput,
  type LicensePlan,
  type LicenseSource,
  type LicenseStatus,
  type RegistrationInput,
  type SubscriptionStatus,
} from './types';
import { hasActiveLicense } from './access';
import { B2B_COUNTRY_MESSAGE, planAllowedFor } from './plans';
import { hasReviewMarkers } from './legal';

const KEY = 'olo-mock-cloud';

interface MockUser {
  id: string;
  email: string;
  password: string;
  confirmed: boolean;
  createdAt: string;
}

interface MockSubscription {
  id: string;
  institutionId: string;
  customerId: string;
  plan: LicensePlan;
  interval?: BillingInterval;
  checkoutSessionId?: string | null;
  status: SubscriptionStatus;
  created: number;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  endedAt: string | null;
}

interface MockDb {
  users: MockUser[];
  profiles: CloudProfile[];
  institutions: CloudInstitution[];
  licenses: CloudLicense[];
  sessionUserId: string | null;
  requireConfirmation: boolean;
  /** Phase 7 */
  customers: Record<string, string>;
  subscriptions: MockSubscription[];
  pendingCheckouts: { institutionId: string; plan: LicensePlan; interval?: BillingInterval; sessionId?: string; completeAt: number }[];
  webhookDelayMs: number;
  checkoutOutcome: 'success' | 'cancel';
  /** Phase 8 */
  legalDocs: AdminLegalDocument[];
  consents: MockConsent[];
  demoGrants: MockDemoGrant[];
  /** Rechtsbetrieb: Kündigungen/Widerrufe über die Website, versendete E-Mails (Nachbau) */
  declarations: AdminDeclarationRow[];
  mails: { kind: string; to: string; subject: string; relatedKey: string | null; at: string }[];
}

interface MockConsent {
  id: string;
  userId: string;
  institutionId: string;
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
  acceptedAt: string;
}

interface MockDemoGrant {
  userId: string;
  institutionId: string;
  startedAt: string;
  expiresAt: string;
  finishedAt: string | null;
  convertedAt: string | null;
}

/* ------------------------------ Rechtstexte: Spiegel der SQL-Regeln ------------------------------ */

const CONSENT_TYPE: Partial<Record<LegalDocType, LegalConsentType>> = {
  terms: 'accepted',
  license_terms: 'accepted',
  b2b_terms: 'accepted',
  privacy: 'acknowledged',
  withdrawal: 'acknowledged',
  consent_immediate_performance: 'agreed',
  consent_withdrawal_loss: 'agreed',
};

/** Spiegel von public.legal_required_documents() */
function requiredTypes(context: LegalConsentContext, type: InstitutionType): LegalDocType[] {
  if (context === 'registration' || context === 'demo') return ['privacy', 'license_terms'];
  return type === 'private'
    ? ['terms', 'privacy', 'withdrawal', 'withdrawal_form', 'license_terms', 'consent_immediate_performance', 'consent_withdrawal_loss']
    : ['terms', 'b2b_terms', 'privacy', 'license_terms'];
}

function requiredDocsOf(db: MockDb, context: LegalConsentContext, type: InstitutionType): LegalDocRef[] {
  const aud: LegalAudience = type === 'private' ? 'b2c' : 'b2b';
  const now = Date.now();
  return requiredTypes(context, type)
    .map((t) => {
      const cands = db.legalDocs.filter((d) => d.status === 'active' && d.type === t && (d.audience === aud || d.audience === 'all') && (!d.effectiveFrom || Date.parse(d.effectiveFrom) <= now));
      const d = cands.find((x) => x.audience === aud) ?? cands[0];
      if (!d) return null;
      const consentType = CONSENT_TYPE[d.type] ?? null;
      return { id: d.id, type: d.type, audience: d.audience, version: d.version, title: d.title, checkboxLabel: d.checkboxLabel, consentType, required: !!consentType };
    })
    .filter((x): x is LegalDocRef => !!x);
}

/** Spiegel von public.legal_record_consents() */
function recordConsents(db: MockDb, userId: string, context: LegalConsentContext, ids: string[], extra: { sessionId?: string | null; plan?: string | null; interval?: BillingInterval | null } = {}) {
  const p = db.profiles.find((x) => x.userId === userId)!;
  const inst = db.institutions.find((i) => i.id === p.institutionId)!;
  if (ids.some((id) => db.legalDocs.find((d) => d.id === id)?.status !== 'active')) throw new CloudError('Die Rechtstexte wurden inzwischen aktualisiert. Bitte prüfe sie und bestätige erneut.', undefined, 'OLC02');
  const req = requiredDocsOf(db, context, inst.type).filter((d) => d.required);
  const already = (docId: string) => context !== 'checkout' && db.consents.some((c) => c.userId === userId && c.documentId === docId);
  if (req.some((d) => !ids.includes(d.id) && !already(d.id))) throw new CloudError('Bitte bestätige alle erforderlichen Rechtstexte.', undefined, 'OLC01');
  for (const d of req) {
    if (!ids.includes(d.id) || already(d.id)) continue;
    const doc = db.legalDocs.find((x) => x.id === d.id)!;
    db.consents.push({
      id: uid(),
      userId,
      institutionId: inst.id,
      customerType: inst.type,
      documentId: d.id,
      documentType: d.type,
      documentVersion: d.version,
      documentAudience: d.audience,
      documentHash: doc.contentHash ?? '',
      consentType: d.consentType!,
      context,
      plan: extra.plan ?? null,
      billingInterval: extra.interval ?? null,
      checkoutSessionId: extra.sessionId ?? null,
      acceptedAt: new Date().toISOString(),
    });
  }
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const empty = (): MockDb => ({
  users: [],
  profiles: [],
  institutions: [],
  licenses: [],
  sessionUserId: null,
  requireConfirmation: false,
  customers: {},
  subscriptions: [],
  pendingCheckouts: [],
  webhookDelayMs: 2500,
  checkoutOutcome: 'success',
  legalDocs: [],
  consents: [],
  demoGrants: [],
  declarations: [],
  mails: [],
});
const DAY = 86400000;
const LIVE: SubscriptionStatus[] = ['active', 'trialing', 'past_due', 'unpaid', 'paused'];

/** Spiegel von public.sync_license_for_institution() */
function syncLicense(db: MockDb, institutionId: string, now = Date.now()) {
  const lic = db.licenses.filter((l) => l.institutionId === institutionId).at(-1);
  if (!lic || lic.source === 'manual') return;
  const sub = [...db.subscriptions.filter((x) => x.institutionId === institutionId)].sort((a, b) => Number(LIVE.includes(b.status)) - Number(LIVE.includes(a.status)) || b.created - a.created)[0];
  if (!sub) return;
  if (lic.source === 'demo') {
    if (!LIVE.includes(sub.status)) return;
    // Kauf während/nach der Demo: Abo übernimmt die Lizenz
    lic.source = 'stripe';
    lic.validFrom = new Date(now).toISOString();
    const g = db.demoGrants.find((x) => x.institutionId === institutionId);
    if (g) {
      g.convertedAt ??= new Date(now).toISOString();
      g.finishedAt ??= new Date(Math.min(now, Date.parse(g.expiresAt))).toISOString();
    }
  }
  lic.plan = sub.plan;
  if (sub.status === 'active' || sub.status === 'trialing') {
    lic.status = 'active';
    lic.gracePeriodUntil = null;
    lic.validFrom ??= new Date(now).toISOString();
    lic.validUntil = sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null;
  } else if (sub.status === 'past_due') {
    lic.gracePeriodUntil ??= new Date(now + 7 * DAY).toISOString();
    lic.status = Date.parse(lic.gracePeriodUntil) <= now ? 'suspended' : 'past_due';
  } else if (sub.status === 'unpaid' || sub.status === 'paused') {
    lic.status = 'suspended';
  } else if (sub.status === 'canceled') {
    lic.status = 'cancelled';
    lic.gracePeriodUntil = null;
    lic.validUntil = sub.endedAt ?? new Date(now).toISOString();
  }
}

export class MockBackend implements CloudBackend {
  readonly kind = 'mock' as const;
  private listeners = new Set<(e: AuthEvent, u: CloudUser | null) => void>();

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage) {}

  private read(): MockDb {
    try {
      const raw = this.storage.getItem(KEY);
      return raw ? { ...empty(), ...(JSON.parse(raw) as MockDb) } : empty();
    } catch {
      return empty();
    }
  }
  private write(db: MockDb) {
    this.storage.setItem(KEY, JSON.stringify(db));
  }
  private emit(e: AuthEvent, u: CloudUser | null) {
    for (const l of this.listeners) l(e, u);
  }
  private asUser(u: MockUser): CloudUser {
    return { id: u.id, email: u.email };
  }
  private delay() {
    return new Promise((r) => setTimeout(r, 30));
  }

  async getUser() {
    const db = this.read();
    const u = db.users.find((x) => x.id === db.sessionUserId);
    return u ? this.asUser(u) : null;
  }

  onAuthChange(cb: (e: AuthEvent, u: CloudUser | null) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async signUp(input: RegistrationInput) {
    validateRegistration(input);
    await this.delay();
    const db = this.read();
    const email = input.email.trim().toLowerCase();
    if (db.users.some((u) => u.email === email)) throw new CloudError('Für diese E-Mail-Adresse existiert bereits ein Konto.', 'email');
    const meta = registrationMetadata(input) as Record<string, string>;
    const user: MockUser = { id: uid(), email, password: input.password, confirmed: !db.requireConfirmation, createdAt: new Date().toISOString() };
    // wie Trigger handle_new_user
    const type = input.institutionType;
    const name = type === 'private' ? `Privat – ${meta.first_name} ${meta.last_name}`.trim() : meta.institution_name;
    const inst: CloudInstitution = {
      id: uid(),
      type,
      name,
      contactName: meta.contact_name ?? null,
      addressLine1: meta.address_line_1 ?? null,
      addressLine2: meta.address_line_2 ?? null,
      postalCode: meta.postal_code ?? null,
      city: meta.city ?? null,
      country: meta.country ?? 'DE',
      vatId: type !== 'private' && meta.vat_id ? meta.vat_id.replace(/\s/g, '').toUpperCase() : null,
      contactPosition: type !== 'private' ? meta.contact_position ?? null : null,
    };
    db.users.push(user);
    db.institutions.push(inst);
    db.profiles.push({ id: uid(), userId: user.id, institutionId: inst.id, firstName: meta.first_name, lastName: meta.last_name, email, role: 'institution_admin', createdAt: user.createdAt });
    db.licenses.push({ id: uid(), institutionId: inst.id, plan: type, status: 'pending', validFrom: null, validUntil: null, maxLocations: 1, source: 'stripe', gracePeriodUntil: null });
    // wie im Trigger: Zustimmungen serverseitig prüfen – fehlt eine, wird nichts angelegt
    try {
      recordConsents(db, user.id, 'registration', input.consentDocumentIds ?? []);
    } catch (e) {
      throw e instanceof CloudError ? e : new CloudError('Registrierung fehlgeschlagen.');
    }
    if (user.confirmed) db.sessionUserId = user.id;
    this.write(db);
    if (user.confirmed) this.emit('SIGNED_IN', this.asUser(user));
    return { user: this.asUser(user), needsConfirmation: !user.confirmed };
  }

  async signIn(emailRaw: string, password: string) {
    await this.delay();
    const db = this.read();
    const u = db.users.find((x) => x.email === emailRaw.trim().toLowerCase());
    if (!u || u.password !== password) throw new CloudError('E-Mail oder Passwort ist nicht korrekt.', 'password');
    if (!u.confirmed) throw new CloudError('Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Bestätigungs-E-Mail).');
    db.sessionUserId = u.id;
    this.write(db);
    this.emit('SIGNED_IN', this.asUser(u));
    return this.asUser(u);
  }

  async signOut() {
    const db = this.read();
    db.sessionUserId = null;
    this.write(db);
    this.emit('SIGNED_OUT', null);
  }

  async requestPasswordReset(email: string) {
    await this.delay();
    if (!email.trim()) throw new CloudError('Bitte E-Mail-Adresse eingeben.', 'email');
    // wie Supabase: keine Auskunft, ob die Adresse existiert
  }

  async updatePassword(password: string) {
    const db = this.read();
    const u = db.users.find((x) => x.id === db.sessionUserId);
    if (!u) throw new CloudError('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
    if (password.length < 8) throw new CloudError('Das Passwort muss mindestens 8 Zeichen haben.', 'password');
    u.password = password;
    this.write(db);
    this.emit('USER_UPDATED', this.asUser(u));
  }

  async loadAccount(user: CloudUser): Promise<CloudAccount> {
    await this.delay();
    const db = this.processWebhooks(this.read());
    const profile = db.profiles.find((p) => p.userId === user.id) ?? null;
    const institution = profile ? db.institutions.find((i) => i.id === profile.institutionId) ?? null : null;
    const license = profile ? db.licenses.find((l) => l.institutionId === profile.institutionId) ?? null : null;
    let billing: BillingStatus | null = null;
    if (profile) {
      const sub = this.currentSub(db, profile.institutionId);
      const hasCustomer = !!db.customers[profile.institutionId];
      const grant = db.demoGrants.find((g) => g.institutionId === profile.institutionId);
      billing = {
        subscriptionStatus: sub?.status ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        cancelAt: sub?.cancelAtPeriodEnd ? sub.currentPeriodEnd : null,
        hasCustomer,
        canManage: hasCustomer && (profile.role === 'institution_admin' || profile.role === 'super_admin'),
        billingInterval: sub?.interval ?? (sub ? 'monthly' : null),
        demoUsed: !!grant,
        demoStartedAt: grant?.startedAt ?? null,
        demoExpiresAt: grant?.expiresAt ?? null,
        serverNow: new Date().toISOString(),
      };
    }
    const account: CloudAccount = { userId: user.id, email: user.email, profile, institution, license, billing };
    if (billing) billing.hasAccess = hasActiveLicense(account);
    return account;
  }

  private currentSub(db: MockDb, institutionId: string) {
    return [...db.subscriptions.filter((x) => x.institutionId === institutionId)].sort((a, b) => Number(LIVE.includes(b.status)) - Number(LIVE.includes(a.status)) || b.created - a.created)[0] ?? null;
  }

  /** Simulierter Webhook: fällige Checkouts werden zu aktiven Abos; abgelaufene Fristen → suspended */
  private processWebhooks(db: MockDb): MockDb {
    const now = Date.now();
    let changed = false;
    for (const pc of db.pendingCheckouts.filter((p) => p.completeAt <= now)) {
      db.subscriptions.push({
        id: `sub_mock_${uid().slice(0, 8)}`,
        institutionId: pc.institutionId,
        customerId: db.customers[pc.institutionId],
        plan: pc.plan,
        interval: pc.interval ?? 'monthly',
        checkoutSessionId: pc.sessionId ?? null,
        status: 'active',
        created: now,
        currentPeriodEnd: new Date(now + (pc.interval === 'yearly' ? 365 : 30) * DAY).toISOString(),
        // wie der Webhook: private Jahreslizenz verlängert sich nicht automatisch
        cancelAtPeriodEnd: pc.plan === 'private' && pc.interval === 'yearly',
        endedAt: null,
      });
      syncLicense(db, pc.institutionId, now);
      // wie der Webhook: Vertragsbestätigung einmal je Checkout-Session
      const buyer = db.profiles.find((p) => p.institutionId === pc.institutionId && p.role !== 'user');
      if (buyer && pc.sessionId) db.mails.push({ kind: 'contract_confirmation', to: buyer.email, subject: 'Vertragsbestätigung', relatedKey: pc.sessionId, at: new Date(now).toISOString() });
      changed = true;
    }
    if (changed) db.pendingCheckouts = db.pendingCheckouts.filter((p) => p.completeAt > now);
    // wie expire_demos(): abgelaufene Demos abschließen
    for (const l of db.licenses) {
      if (l.source === 'demo' && l.status === 'active' && l.validUntil && Date.parse(l.validUntil) <= now) {
        l.status = 'expired';
        changed = true;
      }
    }
    for (const g of db.demoGrants) {
      if (!g.finishedAt && Date.parse(g.expiresAt) <= now) {
        g.finishedAt = g.expiresAt;
        changed = true;
      }
    }
    for (const l of db.licenses) {
      if (l.source !== 'manual' && l.status === 'past_due' && l.gracePeriodUntil && Date.parse(l.gracePeriodUntil) <= now) {
        syncLicense(db, l.institutionId, now);
        changed = true;
      }
    }
    if (changed) this.write(db);
    return db;
  }

  async updateProfileName(userId: string, firstName: string, lastName: string) {
    const db = this.read();
    const p = db.profiles.find((x) => x.userId === userId && userId === db.sessionUserId);
    if (!p) throw new CloudError('Dafür fehlen die Berechtigungen.');
    p.firstName = firstName.trim();
    p.lastName = lastName.trim();
    this.write(db);
  }

  private requireSuperAdmin(db: MockDb) {
    const p = db.profiles.find((x) => x.userId === db.sessionUserId);
    if (p?.role !== 'super_admin') throw new CloudError('Nur für Super-Admins.', undefined, '42501');
  }

  async adminListAccounts(): Promise<AdminAccountRow[]> {
    const db = this.read();
    this.requireSuperAdmin(db);
    return db.profiles.map((p) => {
      const i = db.institutions.find((x) => x.id === p.institutionId)!;
      const l = db.licenses.find((x) => x.institutionId === i.id) ?? null;
      return {
        institutionId: i.id,
        institutionName: i.name,
        institutionType: i.type,
        email: p.email,
        firstName: p.firstName,
        lastName: p.lastName,
        role: p.role,
        licenseId: l?.id ?? null,
        licensePlan: l?.plan ?? null,
        licenseStatus: l?.status ?? null,
        licenseSource: l?.source ?? null,
        validUntil: l?.validUntil ?? null,
        gracePeriodUntil: l?.gracePeriodUntil ?? null,
        subscriptionStatus: this.currentSub(db, i.id)?.status ?? null,
        stripeCustomerId: db.customers[i.id] ?? null,
        stripeSubscriptionId: this.currentSub(db, i.id)?.id ?? null,
        stripePriceId: null,
        currentPeriodEnd: this.currentSub(db, i.id)?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: this.currentSub(db, i.id)?.cancelAtPeriodEnd ?? false,
        registeredAt: p.createdAt,
        vatId: i.vatId ?? null,
        billingInterval: this.currentSub(db, i.id)?.interval ?? null,
        demoUsed: db.demoGrants.some((g) => g.institutionId === i.id),
        demoStartedAt: db.demoGrants.find((g) => g.institutionId === i.id)?.startedAt ?? null,
        demoExpiresAt: db.demoGrants.find((g) => g.institutionId === i.id)?.expiresAt ?? null,
        consentCount: db.consents.filter((c) => c.userId === p.userId).length,
        lastConsentAt: db.consents.filter((c) => c.userId === p.userId).at(-1)?.acceptedAt ?? null,
        consentSummary: [...new Map(db.consents.filter((c) => c.userId === p.userId).map((c) => [c.documentType, { type: c.documentType, version: c.documentVersion, acceptedAt: c.acceptedAt }])).values()],
      };
    });
  }

  async adminSetLicenseStatus(licenseId: string, status: LicenseStatus) {
    const db = this.read();
    this.requireSuperAdmin(db);
    const l = db.licenses.find((x) => x.id === licenseId);
    if (!l) throw new CloudError('Lizenz nicht gefunden.');
    l.status = status;
    l.source = 'manual';
    l.gracePeriodUntil = null;
    if (status === 'active') {
      l.validFrom ??= new Date().toISOString();
      l.validUntil = null;
    }
    this.write(db);
  }

  async adminSetLicenseSource(licenseId: string, source: LicenseSource) {
    const db = this.read();
    this.requireSuperAdmin(db);
    const l = db.licenses.find((x) => x.id === licenseId);
    if (!l) throw new CloudError('Lizenz nicht gefunden.');
    l.source = source;
    if (source === 'stripe') syncLicense(db, l.institutionId);
    this.write(db);
  }

  private sessionAccount(db: MockDb) {
    const p = db.profiles.find((x) => x.userId === db.sessionUserId);
    if (!p) throw new CloudError('Bitte melde dich an.', undefined, 'unauthenticated');
    if (p.role !== 'institution_admin' && p.role !== 'super_admin') throw new CloudError('Nur die Administration deiner Institution kann das Abonnement verwalten.', undefined, 'forbidden');
    const inst = db.institutions.find((i) => i.id === p.institutionId)!;
    return { p, inst, lic: db.licenses.find((l) => l.institutionId === inst.id) ?? null };
  }

  /** wie Edge Function create-checkout-session (ohne echte Zahlung) */
  async startCheckout(plan: LicensePlan, interval: BillingInterval = 'monthly', consentDocumentIds: string[] = []): Promise<string> {
    await this.delay();
    const db = this.read();
    const { p, inst, lic } = this.sessionAccount(db);
    if (interval !== 'monthly' && interval !== 'yearly') throw new CloudError('Unbekanntes Abrechnungsintervall.', undefined, 'unknown_interval');
    if (!['private', 'business', 'education'].includes(plan)) throw new CloudError('Unbekannter Tarif.', undefined, 'unknown_plan');
    if (!planAllowedFor(inst.type, plan)) throw new CloudError('Dieser Tarif passt nicht zu deinem Kontotyp.', undefined, 'plan_mismatch');
    if (inst.type !== 'private' && (inst.country ?? 'DE').toUpperCase() !== 'DE') throw new CloudError(B2B_COUNTRY_MESSAGE, undefined, 'b2b_country');
    if (lic?.source === 'manual' && lic.status === 'active') throw new CloudError('Für deine Institution ist eine Sonderlizenz freigeschaltet. Bitte wende dich an den Support.', undefined, 'manual_license');
    if (db.subscriptions.some((x) => x.institutionId === inst.id && LIVE.includes(x.status))) throw new CloudError('Es besteht bereits ein Abonnement. Du kannst es unter „Abonnement verwalten“ ändern.', undefined, 'subscription_exists');
    // wie die Edge Function: Zustimmungen prüfen, erst dann Kunde + Session, Protokoll mit Session-ID
    const probe = structuredClone(db);
    recordConsents(probe, p.userId, 'checkout', consentDocumentIds, {});
    db.customers[inst.id] ??= `cus_mock_${uid().slice(0, 8)}`;
    const sessionId = `cs_mock_${uid().slice(0, 8)}`;
    recordConsents(db, p.userId, 'checkout', consentDocumentIds, { sessionId, plan, interval });
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (db.checkoutOutcome === 'cancel') {
      this.write(db);
      return `${origin}/pricing?checkout=cancelled`;
    }
    db.pendingCheckouts = db.pendingCheckouts.filter((x) => x.institutionId !== inst.id);
    db.pendingCheckouts.push({ institutionId: inst.id, plan, interval, sessionId, completeAt: Date.now() + db.webhookDelayMs });
    this.write(db);
    return `${origin}/license?checkout=success`;
  }

  /** wie RPC start_demo */
  async startDemo(consentDocumentIds: string[] = []) {
    await this.delay();
    const db = this.read();
    const p = db.profiles.find((x) => x.userId === db.sessionUserId);
    if (!p || (p.role !== 'institution_admin' && p.role !== 'super_admin')) throw new CloudError('Die Demo kann nur die Administration des Kundenkontos starten.', undefined, 'OLD03');
    if (db.demoGrants.some((g) => g.userId === p.userId || g.institutionId === p.institutionId)) throw new CloudError('Die kostenlose Demo wurde für dieses Kundenkonto bereits genutzt.', undefined, 'OLD01');
    const lic = db.licenses.find((l) => l.institutionId === p.institutionId)!;
    const acc: CloudAccount = { userId: p.userId, email: p.email, profile: p, institution: db.institutions.find((i) => i.id === p.institutionId)!, license: lic };
    if (hasActiveLicense(acc) || db.subscriptions.some((x) => x.institutionId === p.institutionId && LIVE.includes(x.status))) throw new CloudError('Für dieses Kundenkonto besteht bereits eine Lizenz – die Demo ist nicht nötig.', undefined, 'OLD02');
    recordConsents(db, p.userId, 'demo', consentDocumentIds, { plan: 'demo' });
    const now = Date.now();
    const expiresAt = new Date(now + 2 * 60 * 60 * 1000).toISOString();
    db.demoGrants.push({ userId: p.userId, institutionId: p.institutionId, startedAt: new Date(now).toISOString(), expiresAt, finishedAt: null, convertedAt: null });
    Object.assign(lic, { status: 'active' as LicenseStatus, source: 'demo' as LicenseSource, validFrom: new Date(now).toISOString(), validUntil: expiresAt, gracePeriodUntil: null });
    this.write(db);
    return { expiresAt, serverNow: new Date(now).toISOString() };
  }

  async requiredLegalDocuments(context: LegalConsentContext, customerType: InstitutionType) {
    await this.delay();
    return requiredDocsOf(this.read(), context, customerType);
  }

  async getLegalDocument(id: string): Promise<LegalDocument | null> {
    const d = this.read().legalDocs.find((x) => x.id === id && x.status !== 'draft');
    return d ? { id: d.id, type: d.type, audience: d.audience, version: d.version, title: d.title, content: d.content, status: d.status, effectiveFrom: d.effectiveFrom, publishedAt: d.publishedAt, archivedAt: d.archivedAt, contentHash: d.contentHash } : null;
  }

  async myConsentedDocumentIds() {
    const db = this.read();
    return [...new Set(db.consents.filter((c) => c.userId === db.sessionUserId).map((c) => c.documentId))];
  }

  async publishedLegalDocuments(): Promise<LegalDocSummary[]> {
    return this.read()
      .legalDocs.filter((d) => d.status === 'active')
      .map((d) => ({ id: d.id, type: d.type, audience: d.audience, version: d.version, title: d.title, effectiveFrom: d.effectiveFrom }));
  }

  async adminLegalList() {
    const db = this.read();
    this.requireSuperAdmin(db);
    return db.legalDocs;
  }

  async adminLegalSaveDraft(d: LegalDraftInput) {
    const db = this.read();
    this.requireSuperAdmin(db);
    if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,19}$/.test(d.version.trim())) throw new CloudError('Ungültige Versionsbezeichnung (z. B. 1.0).', 'version');
    if (!d.title.trim()) throw new CloudError('Bitte einen Titel eingeben.', 'title');
    if (db.legalDocs.some((x) => x.id !== d.id && x.type === d.type && x.audience === d.audience && x.version === d.version.trim())) throw new CloudError('Diese Version existiert bereits.', 'version', '23505');
    const now = new Date().toISOString();
    if (d.id) {
      const doc = db.legalDocs.find((x) => x.id === d.id);
      if (!doc || doc.status !== 'draft') throw new CloudError('Nur Entwürfe können bearbeitet werden – für Änderungen bitte eine neue Version anlegen.', undefined, '42501');
      Object.assign(doc, { type: d.type, audience: d.audience, version: d.version.trim(), title: d.title.trim(), content: d.content, checkboxLabel: d.checkboxLabel?.trim() || null, effectiveFrom: d.effectiveFrom, updatedAt: now });
      this.write(db);
      return doc.id;
    }
    const doc: AdminLegalDocument = { id: uid(), type: d.type, audience: d.audience, version: d.version.trim(), title: d.title.trim(), content: d.content, checkboxLabel: d.checkboxLabel?.trim() || null, status: 'draft', effectiveFrom: d.effectiveFrom, publishedAt: null, archivedAt: null, contentHash: null, createdAt: now, updatedAt: now };
    db.legalDocs.push(doc);
    this.write(db);
    return doc.id;
  }

  async adminLegalActivate(id: string) {
    const db = this.read();
    this.requireSuperAdmin(db);
    const doc = db.legalDocs.find((x) => x.id === id);
    if (!doc || doc.status !== 'draft') throw new CloudError('Nur Entwürfe können veröffentlicht werden.', undefined, '42501');
    if (doc.effectiveFrom && Date.parse(doc.effectiveFrom) > Date.now()) throw new CloudError('Das Datum „gültig ab“ liegt in der Zukunft. Bitte am Stichtag veröffentlichen.');
    if (!doc.content.trim() && !doc.type.startsWith('consent_')) throw new CloudError('Der Inhalt ist leer.');
    if (hasReviewMarkers(doc.content) || hasReviewMarkers(doc.checkboxLabel)) throw new CloudError('Der Entwurf enthält noch [Prüfhinweis]-Markierungen. Bitte klären und entfernen, dann veröffentlichen.');
    const now = new Date().toISOString();
    for (const x of db.legalDocs) if (x.type === doc.type && x.audience === doc.audience && x.status === 'active') Object.assign(x, { status: 'archived', archivedAt: now });
    Object.assign(doc, { status: 'active', publishedAt: now, effectiveFrom: doc.effectiveFrom ?? now, contentHash: `mock-${doc.id.slice(0, 8)}` });
    this.write(db);
  }

  async adminLegalArchive(id: string) {
    const db = this.read();
    this.requireSuperAdmin(db);
    const doc = db.legalDocs.find((x) => x.id === id && x.status === 'active');
    if (!doc) throw new CloudError('Nur aktive Versionen können archiviert werden.');
    Object.assign(doc, { status: 'archived', archivedAt: new Date().toISOString() });
    this.write(db);
  }

  async adminLegalDeleteDraft(id: string) {
    const db = this.read();
    this.requireSuperAdmin(db);
    const i = db.legalDocs.findIndex((x) => x.id === id && x.status === 'draft');
    if (i < 0) throw new CloudError('Nur Entwürfe können gelöscht werden.');
    db.legalDocs.splice(i, 1);
    this.write(db);
  }

  async adminListConsents(institutionId: string): Promise<AdminConsentRow[]> {
    const db = this.read();
    this.requireSuperAdmin(db);
    return db.consents
      .filter((c) => c.institutionId === institutionId)
      .reverse()
      .map((c) => ({
        acceptedAt: c.acceptedAt,
        email: db.profiles.find((p) => p.userId === c.userId)?.email ?? null,
        customerType: c.customerType,
        documentId: c.documentId,
        documentType: c.documentType,
        documentVersion: c.documentVersion,
        documentAudience: c.documentAudience,
        documentHash: c.documentHash,
        consentType: c.consentType,
        context: c.context,
        plan: c.plan,
        billingInterval: c.billingInterval,
        checkoutSessionId: c.checkoutSessionId,
        stripeSubscriptionId: c.checkoutSessionId ? db.subscriptions.find((x) => x.checkoutSessionId === c.checkoutSessionId)?.id ?? null : null,
      }));
  }

  /** wie Edge Function consumer-request: speichern, zuordnen, ggf. automatisch kündigen, bestätigen */
  async submitConsumerDeclaration(input: ConsumerDeclarationInput): Promise<ConsumerDeclarationReceipt> {
    await this.delay();
    const receivedAt = new Date().toISOString();
    if (input.website?.trim()) return { id: null, receivedAt, confirmationSent: false };
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();
    if (!name) throw new CloudError('Bitte gib deinen Namen an.', 'name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new CloudError('Bitte gib die E-Mail-Adresse deines Kundenkontos an.', 'email');
    const cancellationType = input.kind === 'cancellation' ? input.cancellationType ?? 'ordinary' : null;
    if (cancellationType === 'extraordinary' && !input.reason?.trim()) throw new CloudError('Bitte gib bei einer außerordentlichen Kündigung den Grund an.', 'reason');
    const db = this.read();
    const recent = db.declarations.filter((d) => d.email === email && Date.parse(d.receivedAt) > Date.now() - 3600_000).length;
    const profile = db.profiles.find((p) => p.email.toLowerCase() === email);
    const inst = profile ? db.institutions.find((i) => i.id === profile.institutionId) ?? null : null;
    const sub = inst ? this.currentSub(db, inst.id) : undefined;
    const live = sub && LIVE.includes(sub.status) ? sub : undefined;
    const row: AdminDeclarationRow = {
      id: uid(),
      kind: input.kind,
      cancellationType,
      name,
      email,
      contractDetails: input.contract?.trim() || null,
      reason: input.reason?.trim() || null,
      customerType: inst?.type ?? null,
      institutionName: inst?.name ?? null,
      stripeSubscriptionId: live?.id ?? null,
      status: 'needs_review',
      cancelAt: null,
      unmatched: !live,
      confirmationSentAt: null,
      notifiedAt: null,
      handledAt: null,
      receivedAt,
    };
    if (recent < 3) {
      if (input.kind === 'cancellation' && cancellationType === 'ordinary' && live) {
        live.cancelAtPeriodEnd = true;
        row.status = 'processed';
        row.cancelAt = live.currentPeriodEnd;
      }
      const to = profile?.email ?? email;
      db.mails.push({ kind: `${input.kind}_confirmation`, to, subject: input.kind === 'withdrawal' ? 'Eingangsbestätigung deines Widerrufs' : 'Eingangsbestätigung deiner Kündigung', relatedKey: row.id, at: receivedAt });
      db.mails.push({ kind: 'declaration_notice', to: 'info@olo-vision.de', subject: input.kind === 'withdrawal' ? 'Widerruf eingegangen' : 'Kündigung eingegangen', relatedKey: row.id, at: receivedAt });
      row.confirmationSentAt = receivedAt;
      row.notifiedAt = receivedAt;
    }
    db.declarations.push(row);
    if (inst) syncLicense(db, inst.id);
    this.write(db);
    return { id: row.id, receivedAt, confirmationSent: recent < 3 };
  }

  async adminListDeclarations(): Promise<AdminDeclarationRow[]> {
    const db = this.read();
    this.requireSuperAdmin(db);
    return [...db.declarations].reverse();
  }

  async adminSetDeclarationStatus(id: string, status: 'needs_review' | 'done') {
    const db = this.read();
    this.requireSuperAdmin(db);
    const d = db.declarations.find((x) => x.id === id);
    if (!d) throw new CloudError('Erklärung nicht gefunden.');
    d.status = status;
    d.handledAt = status === 'done' ? new Date().toISOString() : null;
    this.write(db);
  }

  /** wie Edge Function create-customer-portal: nur der eigene Kunde */
  async openCustomerPortal(): Promise<string> {
    await this.delay();
    const db = this.read();
    const { inst } = this.sessionAccount(db);
    if (!db.customers[inst.id]) throw new CloudError('Für dein Konto gibt es noch kein Abonnement.', undefined, 'no_customer');
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/account?mock_portal=${encodeURIComponent(db.customers[inst.id])}`;
  }

  /* ------------------------------ Testhaken ------------------------------ */

  hooks() {
    const byEmail = (db: MockDb, email: string) => {
      const u = db.users.find((x) => x.email === email.toLowerCase());
      if (!u) throw new Error(`Unbekannt: ${email}`);
      return { u, p: db.profiles.find((x) => x.userId === u.id)! };
    };
    return {
      setLicenseStatus: (email: string, status: LicenseStatus) => {
        const db = this.read();
        const { p } = byEmail(db, email);
        const l = db.licenses.find((x) => x.institutionId === p.institutionId)!;
        l.status = status;
        this.write(db);
      },
      setRole: (email: string, role: AppRole) => {
        const db = this.read();
        byEmail(db, email).p.role = role;
        this.write(db);
      },
      setRequireConfirmation: (on: boolean) => {
        const db = this.read();
        db.requireConfirmation = on;
        this.write(db);
      },
      confirmEmail: (email: string) => {
        const db = this.read();
        byEmail(db, email).u.confirmed = true;
        this.write(db);
      },
      /** simuliert den Klick auf den Link in der Passwort-Reset-E-Mail */
      openRecoveryLink: (email: string) => {
        const db = this.read();
        const { u } = byEmail(db, email);
        db.sessionUserId = u.id;
        this.write(db);
        this.emit('PASSWORD_RECOVERY', this.asUser(u));
      },
      reset: () => this.storage.removeItem(KEY),
      /** Verzögerung des simulierten Webhooks nach dem Checkout */
      setWebhookDelay: (ms: number) => {
        const db = this.read();
        db.webhookDelayMs = ms;
        this.write(db);
      },
      setCheckoutOutcome: (outcome: 'success' | 'cancel') => {
        const db = this.read();
        db.checkoutOutcome = outcome;
        this.write(db);
      },
      /** Demo-Restzeit setzen (simuliert den Zeitablauf; Server = Browser im Mock) */
      setDemoRemaining: (email: string, ms: number) => {
        const db = this.read();
        const { p } = byEmail(db, email);
        const g = db.demoGrants.find((x) => x.institutionId === p.institutionId);
        const lic = db.licenses.find((x) => x.institutionId === p.institutionId)!;
        const until = new Date(Date.now() + ms).toISOString();
        if (g) g.expiresAt = until;
        lic.validUntil = until;
        this.write(db);
      },
      /** Rechtstext direkt veröffentlichen (Testdaten; im Produkt über das Vertragscenter) */
      publishLegal: (type: LegalDocType, audience: LegalAudience, version: string, checkboxLabel: string | null = null, content: string | null = null) => {
        const db = this.read();
        const now = new Date().toISOString();
        for (const x of db.legalDocs) if (x.type === type && x.audience === audience && x.status === 'active') Object.assign(x, { status: 'archived', archivedAt: now });
        const id = uid();
        db.legalDocs.push({ id, type, audience, version, title: `${type} ${version}`, content: content ?? `# ${type}\n\nPlatzhaltertext Version ${version}.`, checkboxLabel, status: 'active', effectiveFrom: now, publishedAt: now, archivedAt: null, contentHash: `mock-${id.slice(0, 8)}`, createdAt: now, updatedAt: now });
        this.write(db);
        return id;
      },
      /** simulierte Stripe-Ereignisse für das aktuelle Abo der Institution */
      stripeEvent: (email: string, kind: 'payment_failed' | 'paid' | 'cancel_at_period_end' | 'resume' | 'ended' | 'grace_expired') => {
        const db = this.read();
        const { p } = byEmail(db, email);
        const sub = this.currentSub(db, p.institutionId);
        const lic = db.licenses.find((x) => x.institutionId === p.institutionId)!;
        if (!sub) throw new Error('kein Abo');
        if (kind === 'payment_failed') sub.status = 'past_due';
        if (kind === 'paid') sub.status = 'active';
        if (kind === 'cancel_at_period_end') sub.cancelAtPeriodEnd = true;
        if (kind === 'resume') sub.cancelAtPeriodEnd = false;
        if (kind === 'ended') {
          sub.status = 'canceled';
          sub.endedAt = new Date().toISOString();
        }
        if (kind === 'grace_expired') lic.gracePeriodUntil = new Date(Date.now() - 60000).toISOString();
        syncLicense(db, p.institutionId);
        this.write(db);
      },
    };
  }
}
