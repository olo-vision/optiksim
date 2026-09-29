/// <reference types="node" />
/**
 * Gemeinsame Test-Bausteine für die Stripe-Datenbanktests: Stripe-Nachbau und eine BillingDb, die
 * – wie die Edge Functions mit dem Secret Key – als service_role auf die Datenbank zugreift.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { helpers } from './pg';
import type { BillingDb, StripeApi } from '../../supabase/functions/_shared/handlers';
import { DEFAULT_PRICE_IDS } from '../../supabase/functions/_shared/stripeConfig';
import type { SubscriptionSnapshot } from '../../supabase/functions/_shared/stripeObjects';
import type { OpsDb } from '../../supabase/functions/_shared/legalOps';
import type { Mailer, MailMessage } from '../../supabase/functions/_shared/mailer';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);

/* ------------------------------ Stripe-Nachbau ------------------------------ */

export class FakeStripe implements StripeApi {
  n = 0;
  calls: { method: string; path: string; params: Record<string, string>; key?: string }[] = [];
  subs = new Map<string, Obj>();
  invoices = new Map<string, Obj>();
  private idem = new Map<string, Obj>();

  async request(method: 'GET' | 'POST', path: string, params: Record<string, string> = {}, key?: string): Promise<Obj> {
    this.calls.push({ method, path, params, key });
    if (key && this.idem.has(key)) return this.idem.get(key)!;
    let res: Obj;
    if (method === 'POST' && path === 'customers') res = { id: `cus_${++this.n}`, email: params.email, metadata: { institution_id: params['metadata[institution_id]'] } };
    else if (method === 'POST' && path === 'checkout/sessions') res = { id: `cs_${++this.n}`, url: `https://checkout.stripe.test/cs_${this.n}`, customer: params.customer };
    else if (method === 'POST' && /^checkout\/sessions\/[^/]+\/expire$/.test(path)) res = { id: path.split('/')[2], status: 'expired' };
    else if (method === 'POST' && path === 'billing_portal/sessions') res = { id: `bps_${++this.n}`, url: `https://billing.stripe.test/p/${params.customer}` };
    else if (method === 'GET' && path === 'subscriptions') res = { object: 'list', data: [...this.subs.values()].filter((x) => x.customer === params.customer).map((x) => structuredClone(x)) };
    else if (method === 'GET' && path.startsWith('subscriptions/')) {
      const s = this.subs.get(decodeURIComponent(path.slice(14)));
      if (!s) throw new Error('Stripe 404 invalid_request_error resource_missing: No such subscription');
      res = structuredClone(s);
    } else if (method === 'POST' && /^subscriptions\/[^/]+$/.test(path)) {
      // Abo ändern (z. B. cancel_at_period_end) – wie Stripe: liefert das aktualisierte Abo
      const s = this.subs.get(decodeURIComponent(path.slice(14)));
      if (!s) throw new Error('Stripe 404 invalid_request_error resource_missing: No such subscription');
      if (params.cancel_at_period_end !== undefined) {
        s.cancel_at_period_end = params.cancel_at_period_end === 'true';
        s.cancel_at = s.cancel_at_period_end ? s.items?.data?.[0]?.current_period_end ?? null : null;
      }
      res = structuredClone(s);
    } else if (method === 'GET' && path.startsWith('invoices/')) {
      const i = this.invoices.get(decodeURIComponent(path.slice(9)));
      if (!i) throw new Error('Stripe 404: No such invoice');
      res = structuredClone(i);
    } else throw new Error(`unerwartet: ${method} ${path}`);
    if (key) this.idem.set(key, res);
    return res;
  }

  /** Abo im Basil/Dahlia-Format (Perioden an den Items) */
  putSubscription(id: string, customer: string, plan: keyof typeof DEFAULT_PRICE_IDS, institutionId: string, patch: Obj = {}) {
    const start = nowSec() - DAY;
    const prev = this.subs.get(id);
    const sub: Obj = {
      id,
      object: 'subscription',
      customer,
      status: 'active',
      created: start,
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      ended_at: null,
      metadata: { institution_id: institutionId, plan },
      items: { data: [{ id: `si_${id}`, price: { id: DEFAULT_PRICE_IDS[plan] }, current_period_start: start, current_period_end: start + 30 * DAY }] },
      ...(prev ?? {}),
      ...patch,
    };
    this.subs.set(id, sub);
    return sub;
  }
}

/* ------------------------------ Datenbank als service_role ------------------------------ */

export function pgBillingDb(db: PGlite, h: ReturnType<typeof helpers>): BillingDb {
  const q = <T = Obj>(sql: string, params: unknown[] = []) => h.asService(async () => (await db.query<T>(sql, params)).rows);
  return {
    async getAccount(userId) {
      const r = (
        await q<Obj>(
          `select p.user_id, p.email, p.role, i.id as institution_id, i.type, i.name, l.status, l.source
             , i.country from public.profiles p join public.institutions i on i.id = p.institution_id
             left join lateral (select * from public.licenses l2 where l2.institution_id = i.id order by l2.created_at desc limit 1) l on true
            where p.user_id = $1`,
          [userId],
        )
      )[0];
      if (!r) return null;
      return { userId: r.user_id, email: r.email, role: r.role, institutionId: r.institution_id, institutionType: r.type, institutionName: r.name, country: r.country, license: r.status ? { status: r.status, source: r.source } : null };
    },
    async getCustomerId(inst) {
      return (await q<{ c: string }>('select stripe_customer_id as c from public.billing_customers where institution_id = $1', [inst]))[0]?.c ?? null;
    },
    async linkCustomer(inst, cus) {
      await q('insert into public.billing_customers (institution_id, stripe_customer_id) values ($1, $2) on conflict (institution_id) do nothing', [inst, cus]);
      return (await this.getCustomerId(inst))!;
    },
    async getLiveSubscription(inst) {
      return (await q<{ status: string }>(`select status from public.subscriptions where institution_id = $1 and status in ('active','trialing','past_due','unpaid','paused') limit 1`, [inst]))[0] ?? null;
    },
    async eventBegin(id, type, created) {
      return (await q<{ ok: boolean }>('select public.stripe_event_begin($1, $2, $3) as ok', [id, type, created]))[0].ok;
    },
    async eventFinish(id, status, error) {
      await q('select public.stripe_event_finish($1, $2, $3)', [id, status, error ?? null]);
    },
    async checkCheckoutConsents(userId, ids) {
      const r = (await q<{ r: Obj }>('select public.checkout_consent_check($1, $2::uuid[]) as r', [userId, ids]))[0].r;
      return { ok: r.ok === true, outdated: r.outdated === true, missing: r.missing ?? [] };
    },
    async recordCheckoutConsents(userId, ids, sessionId, plan, interval) {
      return (await q<{ n: number }>('select public.record_checkout_consents($1, $2::uuid[], $3, $4, $5) as n', [userId, ids, sessionId, plan, interval]))[0].n;
    },
    async applySubscription(s: SubscriptionSnapshot) {
      return (await q<{ r: Obj }>('select public.apply_stripe_subscription($1::jsonb) as r', [JSON.stringify(s)]))[0].r;
    },
  };
}


/* ------------------------------ Rechtsbetrieb als service_role ------------------------------ */

export function pgOpsDb(db: PGlite, h: ReturnType<typeof helpers>): OpsDb {
  const q = <T = Obj>(sql: string, params: unknown[] = []) => h.asService(async () => (await db.query<T>(sql, params)).rows);
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
  return {
    async recordDeclaration(i) {
      return (await q<{ r: Obj }>('select public.consumer_declaration_record($1, $2, $3, $4, $5, $6) as r', [i.kind, i.cancellationType, i.name, i.email, i.contractDetails, i.reason]))[0].r as never;
    },
    async updateDeclaration(id, status, result, sent, notified) {
      await q('select public.consumer_declaration_update($1, $2, $3::jsonb, $4, $5)', [id, status, JSON.stringify(result), sent, notified]);
    },
    async contractConfirmationData(sessionId) {
      return ((await q<{ r: Obj | null }>('select public.contract_confirmation_data($1) as r', [sessionId]))[0].r ?? null) as never;
    },
    async logMail(kind, to, subject, key, status, error) {
      return (await q<{ ok: boolean }>('select public.system_mail_log($1, $2, $3, $4, $5, $6) as ok', [kind, to, subject, key, status, error]))[0].ok;
    },
    async renewalCandidates(days) {
      return (await q<Obj>('select * from public.renewal_reminder_candidates($1)', [days])).map((r) => ({ ...r, current_period_end: iso(r.current_period_end) })) as never;
    },
    async markRenewal(id) {
      await q('select public.renewal_reminder_mark($1)', [id]);
    },
    async pendingContractConfirmations(days) {
      return (await q<{ s: string }>('select s from public.contract_confirmation_pending($1) as s', [days])).map((r) => r.s);
    },
  };
}

/** Mailer-Attrappe: sammelt Nachrichten; failNext simuliert einen SMTP-Fehler */
export class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  failNext = 0;
  constructor(readonly configured = true, readonly notifyTo: string | null = 'info@olo-vision.de') {}
  async send(m: MailMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('SMTP 421 Service not available');
    }
    this.sent.push(m);
  }
}
