/**
 * Öffentliche Seiten für Rechtstexte (Phase 8) und der gemeinsame öffentliche Rahmen mit Fußzeile.
 *
 *   /legal/doc/:id   GENAU diese Version (aus Checkbox-Links; auch archivierte Versionen bleiben abrufbar)
 *   /legal/:type     aktuell gültige Version eines Dokumenttyps (Fußzeile)
 *
 * Inhalte werden als einfaches Markdown ohne HTML dargestellt (keine Skript-Einschleusung).
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { FileText } from 'lucide-react';
import { BrandMark } from '../../Brand';
import { EmptyState, Pill } from '@/ui/ds';
import { usePageTitle } from '../../usePageTitle';
import { cloudBackend, useCloud } from '../../cloudSession';
import { formatDate, LEGAL_AUDIENCE_LABEL, LEGAL_DOC_TYPE_LABEL, PRODUCT_NAME } from '@/cloud/plans';
import { parseMarkdown, REVIEW_MARKER, type Inline } from '@/cloud/legal';
import type { LegalDocSummary, LegalDocType, LegalDocument } from '@/cloud/types';
import { LEGAL_DOC_TYPES } from '@/cloud/types';
import { cloudLandingPath } from './cloudLanding';

/* ------------------------------ öffentlicher Rahmen ------------------------------ */

/** In der Fußzeile verlinkte Dokumenttypen (sofern veröffentlicht) */
const FOOTER_TYPES: LegalDocType[] = ['imprint', 'terms', 'privacy', 'withdrawal', 'license_terms'];
const DOC_PATH: Partial<Record<LegalDocType, string>> = { imprint: '/impressum' };
export const legalTypePath = (t: LegalDocType) => DOC_PATH[t] ?? `/legal/${t}`;

/**
 * Rechtliche Links. „Verträge hier kündigen“ (§ 312k BGB) und „Vertrag widerrufen“ (§ 356a BGB) sind immer
 * sichtbar – auch bevor Rechtstexte veröffentlicht sind –, weil sie ständig verfügbar sein müssen.
 */
export function LegalFooterLinks({ compact = false }: { compact?: boolean }) {
  const [docs, setDocs] = useState<LegalDocSummary[]>([]);
  useEffect(() => {
    let alive = true;
    cloudBackend()
      .publishedLegalDocuments()
      .then((d) => alive && setDocs(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const types = FOOTER_TYPES.filter((t) => docs.some((d) => d.type === t));
  return (
    <nav className={`legal-links${compact ? ' legal-links--compact' : ''}`} aria-label="Rechtliches" data-testid="legal-footer">
      {types.map((t) => (
        <Link key={t} to={legalTypePath(t)}>
          {LEGAL_DOC_TYPE_LABEL[t]}
        </Link>
      ))}
      <Link to="/kuendigen" className="legal-links__action" data-testid="footer-cancel">
        Verträge hier kündigen
      </Link>
      <Link to="/widerrufen" className="legal-links__action" data-testid="footer-withdraw">
        Vertrag widerrufen
      </Link>
    </nav>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  const user = useCloud((s) => s.user);
  return (
    <div className="public">
      <header className="public__bar">
        <Link to="/" className="public__brand">
          <BrandMark size={26} /> <span>{PRODUCT_NAME}</span>
        </Link>
        <nav className="public__nav">
          <Link to="/pricing">Tarife</Link>
          {user ? (
            <Link to={cloudLandingPath()} className="btn btn--accent">
              Zu meinem Konto
            </Link>
          ) : (
            <>
              <Link to="/login">Anmelden</Link>
              <Link to="/register" className="btn btn--accent">
                Registrieren
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className="public__main">{children}</main>
      <footer className="public__footer">
        <span>
          © {new Date().getFullYear()} {PRODUCT_NAME}
        </span>
        <LegalFooterLinks />
      </footer>
    </div>
  );
}

/* ------------------------------ Markdown ------------------------------ */

const renderInline = (parts: Inline[]) => parts.map((p, i) => (p.br ? <br key={i} /> : p.bold ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>));

export function LegalMarkdown({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  return (
    <div className="legal-md">
      {blocks.map((b, i) => {
        if (b.kind === 'ul' || b.kind === 'ol') {
          const items = b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>);
          return b.kind === 'ul' ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
        }
        const inline = renderInline(b.inline);
        if (b.kind === 'h1') return <h2 key={i}>{inline}</h2>;
        if (b.kind === 'h2') return <h3 key={i}>{inline}</h3>;
        if (b.kind === 'h3') return <h4 key={i}>{inline}</h4>;
        // Prüfhinweise sichtbar hervorheben (Entwürfe; veröffentlichte Fassungen nur, wenn ein Super-Admin sie bewusst mit Hinweisen freigegeben hat)
        if (b.inline[0]?.text.startsWith(REVIEW_MARKER)) return <p key={i} className="legal-md__review" data-testid="review-marker">{inline}</p>;
        return <p key={i}>{inline}</p>;
      })}
    </div>
  );
}

function LegalDocView({ doc }: { doc: LegalDocument }) {
  return (
    <article className="legal-doc" data-testid="legal-doc" data-version={doc.version}>
      <header className="legal-doc__head">
        <span className="legal-doc__eyebrow">
          <FileText size={13} /> {LEGAL_DOC_TYPE_LABEL[doc.type]}
        </span>
        <h1>{doc.title}</h1>
        <p className="legal-doc__meta">
          <Pill tone={doc.status === 'active' ? 'ok' : 'neutral'}>{doc.status === 'active' ? 'Aktuelle Fassung' : 'Frühere Fassung'}</Pill>
          <span>Version {doc.version}</span>
          <span>Gültig ab {formatDate(doc.effectiveFrom)}</span>
          {doc.audience !== 'all' && <span>{LEGAL_AUDIENCE_LABEL[doc.audience]}</span>}
        </p>
        {doc.status === 'archived' && (
          <p className="auth-note">
            Diese Fassung ist nicht mehr aktuell. Sie wird für die Nachvollziehbarkeit früherer Zustimmungen weiterhin angezeigt. <Link to={legalTypePath(doc.type)}>Aktuelle Fassung</Link>
          </p>
        )}
      </header>
      <LegalMarkdown content={doc.content} />
    </article>
  );
}

export function LegalDocumentPage() {
  const { id = '' } = useParams();
  const [doc, setDoc] = useState<LegalDocument | null | undefined>(undefined);
  usePageTitle(doc?.title ?? 'Rechtliches');
  useEffect(() => {
    setDoc(undefined);
    cloudBackend()
      .getLegalDocument(id)
      .then(setDoc)
      .catch(() => setDoc(null));
  }, [id]);
  return <PublicShell>{doc === undefined ? <p className="muted">Wird geladen …</p> : doc ? <LegalDocView doc={doc} /> : <EmptyState icon={FileText} title="Dokument nicht gefunden" text="Dieses Dokument ist nicht (mehr) veröffentlicht." />}</PublicShell>;
}

/** Impressum unter /impressum */
export function ImprintPage() {
  return <LegalTypePage fixedType="imprint" />;
}

export function LegalTypePage({ fixedType }: { fixedType?: LegalDocType } = {}) {
  const params0 = useParams();
  const type = fixedType ?? params0.type ?? '';
  const [params] = useSearchParams();
  const [list, setList] = useState<LegalDocSummary[] | null>(null);
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const valid = (LEGAL_DOC_TYPES as string[]).includes(type);
  const variants = (list ?? []).filter((d) => d.type === type);
  const wanted = params.get('audience');
  const pick = variants.find((d) => d.audience === wanted) ?? variants.find((d) => d.audience === 'all') ?? variants[0];
  usePageTitle(valid ? LEGAL_DOC_TYPE_LABEL[type as LegalDocType] : 'Rechtliches');
  useEffect(() => {
    cloudBackend()
      .publishedLegalDocuments()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  useEffect(() => {
    if (!pick) return;
    cloudBackend()
      .getLegalDocument(pick.id)
      .then(setDoc)
      .catch(() => setDoc(null));
  }, [pick?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <PublicShell>
      {variants.length > 1 && (
        <nav className="legal-variants">
          {variants.map((v) => (
            <Link key={v.id} to={`${legalTypePath(type as LegalDocType)}?audience=${v.audience}`} className={v.id === pick?.id ? 'is-on' : ''}>
              {LEGAL_AUDIENCE_LABEL[v.audience]}
            </Link>
          ))}
        </nav>
      )}
      {list === null ? (
        <p className="muted">Wird geladen …</p>
      ) : !pick ? (
        <EmptyState icon={FileText} title="Noch nicht veröffentlicht" text="Dieses Dokument wird derzeit vorbereitet." />
      ) : doc ? (
        <LegalDocView doc={doc} />
      ) : (
        <p className="muted">Wird geladen …</p>
      )}
    </PublicShell>
  );
}
