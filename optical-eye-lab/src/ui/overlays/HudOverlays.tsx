/**
 * HUD-Elemente über dem Viewport: Hover-Info, Maßkette, Statusleiste, Hinweise.
 */
import { useMemo } from 'react';
import { CheckCircle2, Info, PanelLeft, PanelRight, TriangleAlert } from 'lucide-react';
import { useAppStore, findEntity } from '@/state/store';
import { useHoverStore } from '@/scene/interaction/hover';
import { useTraceResultStore } from '@/scene/overlays/traceResultStore';
import { entityInfo } from '@/model/derived/infoCards';
import { computeMeasurements } from '@/model/derived/measurements';
import { formatNumber, formatValue } from '@/core/units';
import { ElementGlyph, EyeGlyph } from '../common/ElementGlyph';

export function HoverTooltip() {
  const target = useHoverStore((s) => s.target);
  const x = useHoverStore((s) => s.x);
  const y = useHoverStore((s) => s.y);
  const doc = useAppStore((s) => s.doc);
  const enabled = useAppStore((s) => s.prefs.showHoverInfo);
  if (!enabled || !target) return null;
  const e = findEntity(doc, target.entityId);
  if (!e) return null;
  const card = entityInfo(e, target.part);
  const left = Math.min(x + 18, window.innerWidth - 260);
  const top = Math.min(y + 18, window.innerHeight - 40 - card.rows.length * 20 - 60);
  return (
    <div className="hover-tip" style={{ left, top }}>
      <div className="hover-tip__title">{card.title}</div>
      {card.subtitle && <div className="hover-tip__sub">{card.subtitle}</div>}
      <dl>
        {card.rows.slice(0, 5).map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="hover-tip__hint">Klicken für Details</div>
    </div>
  );
}

export function MeasurementBar() {
  const doc = useAppStore((s) => s.doc);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const decimals = useAppStore((s) => s.prefs.decimals);
  const result = useTraceResultStore((s) => s.result);
  const report = useMemo(() => computeMeasurements(doc), [doc]);
  const focus = doc.display.showRays ? result?.focus : null;

  return (
    <div className="measure-bar">
      <span className="measure-bar__label">Maßkette</span>
      <div className="measure-bar__chain">
        <button type="button" className={`mchip mchip--eye${selectedId === doc.eye.id ? ' is-selected' : ''}`} onClick={() => select(doc.eye.id)}>
          <EyeGlyph size={14} />
          <span>Hornhautscheitel</span>
        </button>
        {report.chain.length === 0 && <span className="measure-bar__empty">Keine Elemente vor dem Auge</span>}
        {report.chain.map((c) => {
          const p = report.placements.find((x) => x.id === c.toId)!;
          return (
            <span key={c.toId} className="measure-bar__seg">
              <span className={`mgap${c.gap < 0 ? ' is-warn' : ''}`}>
                <span className="mgap__line" />
                <span className="mgap__value">{formatValue(c.gap, 'mm', Math.min(decimals, 2))}</span>
                <span className="mgap__line" />
              </span>
              <button type="button" className={`mchip${selectedId === c.toId ? ' is-selected' : ''}`} onClick={() => select(c.toId)}>
                <ElementGlyph kind={p.element.kind} size={14} />
                <span>{p.name}</span>
              </button>
            </span>
          );
        })}
      </div>
      {focus && (
        <span
          className={`measure-bar__focus${Math.abs(focus.paraxialDefocusMm) < 0.05 ? ' is-ok' : ''}`}
          data-tip="Lage des achsnahen Fokus relativ zur Retina (Vorschau-Raytracing). Details in der Lichtquelle."
          data-tip-side="top"
        >
          Fokus {Math.abs(focus.paraxialDefocusMm) < 0.05 ? 'auf Retina' : `${formatNumber(Math.abs(focus.paraxialDefocusMm), 2)} mm ${focus.paraxialDefocusMm < 0 ? 'vor' : 'hinter'} Retina`}
        </span>
      )}
    </div>
  );
}

const TOOL_LABEL = { select: 'Auswahl', translate: 'Verschieben', rotate: 'Drehen' } as const;

export function StatusBar() {
  const tool = useAppStore((s) => s.tool);
  const snapping = useAppStore((s) => s.snapping);
  const space = useAppStore((s) => s.transformSpace);
  const projection = useAppStore((s) => s.projection);
  const quality = useAppStore((s) => s.prefs.quality);
  const dirty = useAppStore((s) => s.dirty);
  const entity = useAppStore((s) => findEntity(s.doc, s.selectedId));
  const leftOpen = useAppStore((s) => s.leftPanelOpen);
  const rightOpen = useAppStore((s) => s.rightPanelOpen);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const prefs = useAppStore((s) => s.prefs);
  const p = entity?.transform.position;
  return (
    <footer className="statusbar">
      <div className="statusbar__group">
        {!leftOpen && (
          <button type="button" className="statusbar__btn" onClick={() => togglePanel('left')} data-tip="Szenenbaum einblenden  ·  [" data-tip-side="top">
            <PanelLeft size={13} />
          </button>
        )}
        <span>{TOOL_LABEL[tool]}</span>
        <span className="statusbar__dot" />
        <span>{space === 'world' ? 'Weltachsen' : 'Lokale Achsen'}</span>
        <span className="statusbar__dot" />
        <span className={snapping ? 'is-on' : ''}>{snapping ? `Einrasten ${formatNumber(prefs.translationSnap, 1)} mm / ${prefs.rotationSnap}°` : 'Einrasten aus'}</span>
      </div>
      <div className="statusbar__group statusbar__group--center">
        {entity && p ? (
          <>
            <span className="statusbar__strong">{entity.name}</span>
            <span className="statusbar__mono">
              X {formatNumber(p[0], 2)} · Y {formatNumber(p[1], 2)} · Z {formatNumber(p[2], 2)} mm
            </span>
          </>
        ) : (
          <span className="statusbar__muted">Links: auswählen · Rechts: drehen · Mitte: verschieben · Rad: zoomen</span>
        )}
      </div>
      <div className="statusbar__group statusbar__group--right">
        <span>{projection === 'perspective' ? 'Perspektive' : 'Orthografisch'}</span>
        <span className="statusbar__dot" />
        <span>Qualität: {quality === 'high' ? 'Hoch' : quality === 'balanced' ? 'Ausgewogen' : 'Leistung'}</span>
        <span className="statusbar__dot" />
        <span className={dirty ? 'is-warn' : 'is-ok'} data-tip="Bezogen auf den zuletzt gespeicherten/geladenen Stand. Der Arbeitsstand wird zusätzlich automatisch im Browser gesichert." data-tip-side="top">
          {dirty ? 'Ungespeicherte Änderungen' : 'Keine Änderungen'}
        </span>
        <span className="statusbar__dot" />
        <span className="statusbar__muted">1 Einheit = 1 mm</span>
        {!rightOpen && (
          <button type="button" className="statusbar__btn" onClick={() => togglePanel('right')} data-tip="Inspector einblenden  ·  ]" data-tip-side="top">
            <PanelRight size={13} />
          </button>
        )}
      </div>
    </footer>
  );
}

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`} onClick={() => dismiss(t.id)}>
          {t.tone === 'success' ? <CheckCircle2 size={15} /> : t.tone === 'warning' ? <TriangleAlert size={15} /> : <Info size={15} />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
