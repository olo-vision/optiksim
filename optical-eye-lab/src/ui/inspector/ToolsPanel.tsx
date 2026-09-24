/**
 * Werkzeuge (Phase 4): optische Rechner, verknüpft mit der Auswahl.
 * Werte werden aus der Simulation übernommen; wo sinnvoll kann das Ergebnis zurückgeschrieben werden.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import type { LensElement } from '@/model/types';
import { EYE_ID } from '@/model/types';
import { useAppStore, findEntity } from '@/state/store';
import { lensOptics, designLensForRx } from '@/engine/physics/lensOptics';
import { placementOf } from '@/model/derived/measurements';
import { placeAtVertexDistance } from '@/model/sceneFactory';
import { eyeRefractionState } from '@/engine/physics/eyeRefraction';
import { backVertexPower, imaging, keratometry, magnifier, prentice, spectacleToContact, tearLensQuick, vergenceTransfer, vertexConversion, type CalcResult } from '@/engine/optics/calculators';
import { explainTransposition, formatRx, type Explanation } from '@/engine/physics/explain';
import { normalizeAxis, type Rx } from '@/core/math/powerMatrix';
import { formatNumber, formatPower } from '@/core/units';
import { ExplainButton } from '../common/Explain';
import { NumberField } from '../common/fields';

function ToolCard({ title, sub, children, open: initial = false, testId }: { title: string; sub?: string; children: ReactNode; open?: boolean; testId?: string }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="tool-card" data-testid={testId}>
      <button type="button" className="tool-card__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
        {sub && <small>{sub}</small>}
      </button>
      {open && <div className="tool-card__body">{children}</div>}
    </div>
  );
}

function Result({ value, explanation }: { value: ReactNode; explanation: Explanation }) {
  return (
    <div className="tool-card__result">
      <span>{value}</span>
      <ExplainButton explanation={explanation} />
    </div>
  );
}

function RxInputs({ rx, onChange }: { rx: Rx; onChange: (r: Rx) => void }) {
  return (
    <>
      <NumberField label="Sph" unit="dpt" step={0.25} decimals={2} value={rx.sph} onChange={(v) => onChange({ ...rx, sph: v })} />
      <NumberField label="Cyl" unit="dpt" step={0.25} decimals={2} value={rx.cyl} onChange={(v) => onChange({ ...rx, cyl: v })} />
      <NumberField label="Achse" unit="deg" step={5} decimals={0} min={0} max={180} value={rx.axis} onChange={(v) => onChange({ ...rx, axis: normalizeAxis(v) })} />
    </>
  );
}

/** Lokaler Zustand, der bei Auswahländerung aus der Simulation neu übernommen wird */
function useLinked<T>(source: T, key: string): [T, (v: T) => void, () => void] {
  const [v, setV] = useState(source);
  useEffect(() => setV(source), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, setV, () => setV(source)];
}

const Reset = ({ onClick, label = 'Aus Simulation übernehmen' }: { onClick: () => void; label?: string }) => (
  <button type="button" className="btn btn--ghost" onClick={onClick}>
    <RotateCcw size={12} /> {label}
  </button>
);

export function ToolsPanel() {
  const doc = useAppStore((s) => s.doc);
  const selectedId = useAppStore((s) => s.selectedId);
  const hidden = !!doc.training?.hidden;
  const entity = findEntity(doc, selectedId);
  const lens = entity?.entityType === 'element' && entity.family === 'lens' ? (entity as LensElement) : null;
  const lensRx = useMemo<Rx>(() => (lens ? lensOptics(lens, doc.eye).rx : { sph: -4, cyl: 0, axis: 180 }), [lens, doc.eye]);
  const place = lens ? placementOf(doc.eye, lens) : null;
  const hsa = place && !lens?.contact ? place.vertexDistance : 12;
  const eyeRx = useMemo(() => eyeRefractionState(doc.eye.anatomy).rx, [doc.eye.anatomy]);
  const key = `${selectedId ?? 'none'}:${lens ? JSON.stringify(lens.lens) : ''}:${hsa.toFixed(3)}`;

  // HSA-Umrechnung
  const [vRx, setVRx, resetV] = useLinked<Rx>(lensRx, key);
  const [d1, setD1, resetD1] = useLinked(hsa, key);
  const [d2, setD2] = useState(16);
  const vc = vertexConversion(vRx, d1, d2);
  const applyHsa = () => {
    if (!lens || lens.contact) return;
    const s = useAppStore.getState();
    s.commit((d) => ({
      ...d,
      elements: d.elements.map((e) => {
        if (e.id !== lens.id || e.family !== 'lens') return e;
        const designed = { ...e, lens: designLensForRx(e, vc.value.converted).lens };
        const placed = placeAtVertexDistance(designed, d, d2);
        return { ...designed, transform: { ...placed.transform, rotation: e.transform.rotation } };
      }),
    }));
    s.notify(`Glas auf HSA ${formatNumber(d2, 1)} mm gesetzt, Wirkung ${formatRx(vc.value.converted)}`, 'success');
  };

  // Brille → KL
  const [kRx, setKRx, resetK] = useLinked<Rx>(lens && !lens.contact ? lensRx : eyeRx, key);
  const [kHsa, setKHsa] = useLinked(hsa, key);
  const kl = spectacleToContact(kRx, kHsa);

  // Prentice
  const [pRx, setPRx, resetP] = useLinked<Rx>(lensRx, key);
  // Blickpunkt relativ zum optischen Mittelpunkt im TABO-Rahmen: −(Dezentration), lokal x → TABO −x
  const [cx, setCx] = useLinked(place ? place.decentration.x : 0, key);
  const [cy, setCy] = useLinked(place ? -place.decentration.y : 5, key);
  const pr = prentice(pRx, cx, cy);

  // dicke Linse
  const [r1, setR1, resetR1] = useLinked(lens?.lens.frontRadius ?? 100, key);
  const [r2, setR2] = useLinked(lens?.lens.backRadius ?? 200, key);
  const [nn, setN] = useLinked(lens?.medium.n ?? 1.5, key);
  const [tt, setT] = useLinked(lens?.lens.centerThickness ?? 3, key);
  const bv = backVertexPower(r1, r2, nn, tt);

  // Abbildung
  const eqPower = lens ? (lensRx.sph + lensRx.cyl / 2) : 10;
  const [F, setF, resetF] = useLinked(Number(eqPower.toFixed(2)), key);
  const [a, setA] = useState(-250);
  const im = imaging(F, a);

  // Keratometer / Tränenlinse
  const K1 = keratometry(doc.eye.anatomy.corneaFrontRadius);
  const R2 = doc.eye.anatomy.corneaFrontRadius2;
  const K2 = R2 !== undefined ? keratometry(R2) : null;
  const [bc, setBc] = useLinked(lens?.contact ? lens.lens.backRadius : 7.7, key);
  const [kr, setKr] = useLinked(Math.max(doc.eye.anatomy.corneaFrontRadius, R2 ?? 0), key);
  const tl = tearLensQuick(bc, kr, lens?.contact?.nTear ?? 1.336);

  // Vergenz, Lupe, Transposition
  const [L1, setL1] = useState(-2);
  const [dd, setDd] = useState(100);
  const vt = vergenceTransfer(L1, dd);
  const [mag, setMag] = useState(lens?.kind === 'magnifier' ? Number(eqPower.toFixed(1)) : 16);
  const mg = magnifier(mag);
  const [tRx, setTRx, resetT] = useLinked<Rx>(lensRx, key);

  const src = lens ? `aus „${lens.name}“` : 'freie Eingabe';
  return (
    <div className="tools-panel">
      <p className="insp-hint" style={{ padding: '8px 12px 0' }}>
        Rechner übernehmen die Werte der Auswahl ({src}). Ergebnisse mit ⓘ zeigen Formel und eingesetzte Werte.
      </p>

      <ToolCard title="HSA-Umrechnung" sub={src} open={!!lens && !lens.contact} testId="tool-hsa">
        <RxInputs rx={vRx} onChange={setVRx} />
        <NumberField label="HSA alt d₁" unit="mm" step={0.5} decimals={1} min={0} max={40} value={d1} onChange={setD1} />
        <NumberField label="HSA neu d₂" unit="mm" step={0.5} decimals={1} min={0} max={40} value={d2} onChange={setD2} />
        <Result value={formatRx(vc.value.converted)} explanation={vc.explanation} />
        <div className="wb-row">
          <Reset
            onClick={() => {
              resetV();
              resetD1();
            }}
          />
          {lens && !lens.contact && (
            <button type="button" className="btn" onClick={applyHsa} data-testid="apply-hsa">
              Glas umsetzen
            </button>
          )}
        </div>
      </ToolCard>

      <ToolCard title="Brille → Kontaktlinse" sub={lens && !lens.contact ? src : hidden ? 'Eingabe' : 'aus Refraktion'}>
        <RxInputs rx={kRx} onChange={setKRx} />
        <NumberField label="HSA" unit="mm" step={0.5} decimals={1} min={0} max={30} value={kHsa} onChange={setKHsa} />
        <Result value={formatRx(kl.value)} explanation={kl.explanation} />
        {!hidden && <Reset onClick={resetK} />}
      </ToolCard>

      <ToolCard title="Prentice-Regel (Prisma)" sub={src}>
        <RxInputs rx={pRx} onChange={setPRx} />
        <NumberField label="Blickpunkt → (TABO 0°)" unit="mm" step={0.5} decimals={1} value={cx} onChange={setCx} />
        <NumberField label="Blickpunkt ↑" unit="mm" step={0.5} decimals={1} value={cy} onChange={setCy} />
        <Result value={`${formatNumber(pr.value.amount, 2)} cm/m · Basis ${formatNumber(pr.value.base, 0)}°`} explanation={pr.explanation} />
        <Reset onClick={resetP} />
      </ToolCard>

      <ToolCard title="Scheitelbrechwert (dicke Linse)" sub={src}>
        <NumberField label="r₁" unit="mm" step={1} decimals={2} value={r1} onChange={setR1} zeroMeansInfinity />
        <NumberField label="r₂" unit="mm" step={1} decimals={2} value={r2} onChange={setR2} zeroMeansInfinity />
        <NumberField label="n" unit="n" step={0.01} decimals={3} min={1} max={2.2} value={nn} onChange={setN} />
        <NumberField label="Mittendicke" unit="mm" step={0.1} decimals={2} min={0.01} value={tt} onChange={setT} />
        <Result value={`S'∞ = ${formatPower(bv.value.S)}`} explanation={bv.explanation} />
        <Reset onClick={resetR1} />
      </ToolCard>

      <ToolCard title="Abbildung (Linsengleichung)" sub={lens ? `F aus „${lens.name}“` : undefined}>
        <NumberField label="Brechwert F" unit="dpt" step={0.25} decimals={2} value={F} onChange={setF} />
        <NumberField label="Gegenstandsweite a" unit="mm" step={10} decimals={0} value={a} onChange={setA} />
        <Result value={`a' = ${Number.isFinite(im.value.a2) ? `${formatNumber(im.value.a2, 1)} mm` : '∞'} · β' = ${Number.isFinite(im.value.beta) ? formatNumber(im.value.beta, 3) : '∞'}`} explanation={im.explanation} />
        <Reset onClick={resetF} />
      </ToolCard>

      <ToolCard title="Keratometer" sub="aus dem Auge">
        <Result value={`${formatNumber(doc.eye.anatomy.corneaFrontRadius, 2)} mm → ${formatPower(K1.value)}`} explanation={K1.explanation} />
        {K2 && R2 !== undefined && <Result value={`${formatNumber(R2, 2)} mm → ${formatPower(K2.value)}  (Δ ${formatPower(Math.abs(K1.value - K2.value))})`} explanation={K2.explanation} />}
      </ToolCard>

      <ToolCard title="Tränenlinse (Näherung)" sub={lens?.contact ? src : undefined}>
        <NumberField label="Basiskurve" unit="mm" step={0.05} decimals={2} value={bc} onChange={setBc} />
        <NumberField label="Hornhautradius (flach)" unit="mm" step={0.05} decimals={2} value={kr} onChange={setKr} />
        <Result value={formatPower(tl.value)} explanation={tl.explanation} />
      </ToolCard>

      <ToolCard title="Vergenzübertragung">
        <NumberField label="Vergenz L₁" unit="dpt" step={0.25} decimals={2} value={L1} onChange={setL1} />
        <NumberField label="Strecke d" unit="mm" step={5} decimals={1} value={dd} onChange={setDd} />
        <Result value={formatPower(vt.value)} explanation={vt.explanation} />
      </ToolCard>

      <ToolCard title="Lupe">
        <NumberField label="Brechwert" unit="dpt" step={1} decimals={1} value={mag} onChange={setMag} />
        <Result value={`${formatNumber(mg.value, 2)}×`} explanation={mg.explanation} />
      </ToolCard>

      <ToolCard title="Transposition" sub={src}>
        <RxInputs rx={tRx} onChange={setTRx} />
        <Result value={formatRx({ sph: tRx.sph + tRx.cyl, cyl: -tRx.cyl, axis: normalizeAxis(tRx.axis + 90) })} explanation={explainTransposition(tRx)} />
        <Reset onClick={resetT} />
      </ToolCard>

      {selectedId === EYE_ID && <p className="insp-hint" style={{ padding: '0 12px 12px' }}>Tipp: Ein Glas auswählen – die Rechner übernehmen dann Stärke, HSA und Geometrie.</p>}
    </div>
  );
}

export type { CalcResult };
