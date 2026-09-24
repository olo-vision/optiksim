/**
 * Fachinfo (Phase 4): fachliche Kennwerte zum ausgewählten Objekt – mit Formel und eingesetzten Werten (ⓘ).
 * Im Trainingsfall werden Refraktionswerte des Auges verborgen.
 */
import { useMemo } from 'react';
import type { EyeEntity, LensElement, SceneDocument } from '@/model/types';
import { useAppStore, findEntity } from '@/state/store';
import { EYE_ID } from '@/model/types';
import { eyeRefractionState } from '@/engine/physics/eyeRefraction';
import { summarizeEye } from '@/engine/physics/eyeOptics';
import { computeCorrection } from '@/engine/physics/correction';
import { lensOptics } from '@/engine/physics/lensOptics';
import { tearLens } from '@/engine/physics/contactLens';
import { placementOf } from '@/model/derived/measurements';
import { explainEffectivePower, explainPrincipalMeridians, formatRx, explainEyeRefraction, type Explanation } from '@/engine/physics/explain';
import { effectivityMatrix, matrixToRx } from '@/core/math/powerMatrix';
import { formatNumber, formatPower } from '@/core/units';
import { keratometry, refractionAtVertex } from '@/engine/optics/calculators';
import { accommodationAmplitude, chromaticRefractionShift } from '@/engine/optics/vision';
import { LAMBDA_C, LAMBDA_F } from '@/engine/optics/dispersion';
import { findMaterial } from '@/model/media';
import { analyzeFluorescein, FIT_LABEL } from '@/engine/optics/fluorescein';
import { ReadoutRow } from '../common/fields';
import { MaterialReadouts } from './MaterialFields';

const surfaceExplain = (label: string, n1: number, n2: number, rMm: number, F: number): Explanation => ({
  title: `Flächenbrechwert ${label}`,
  formula: 'F = (n₂ − n₁) / r',
  substitution: `F = (${formatNumber(n2, 4)} − ${formatNumber(n1, 4)}) / ${formatNumber(rMm / 1000, 5)} m`,
  result: formatPower(F),
  text: 'Eine gekrümmte Grenzfläche zwischen zwei Medien bricht umso stärker, je größer der Indexunterschied und je kleiner der Radius ist.',
});

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fach-block">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function EyeFach({ eye, doc, hidden }: { eye: EyeEntity; doc: SceneDocument; hidden: boolean }) {
  const a = eye.anatomy;
  const st = useMemo(() => eyeRefractionState(a), [a]);
  const sum = useMemo(() => summarizeEye(a), [a]);
  const R2 = a.corneaFrontRadius2 ?? a.corneaFrontRadius;
  const Ff = (1000 * (a.nCornea - 1)) / a.corneaFrontRadius;
  const Fb = (1000 * (a.nAqueous - a.nCornea)) / a.corneaBackRadius;
  const K1 = keratometry(a.corneaFrontRadius);
  const K2 = keratometry(R2);
  const lca = chromaticRefractionShift(a, LAMBDA_C) - chromaticRefractionShift(a, LAMBDA_F);
  const at12 = refractionAtVertex(st.matrix, 12);
  const farPoint = Math.abs(st.rx.sph) < 1e-6 ? '∞' : `${formatNumber(1000 / st.rx.sph, 0)} mm`;
  const amp = eye.patient ? (eye.patient.amplitude ?? accommodationAmplitude(eye.patient.age)) : null;
  const corr = useMemo(() => computeCorrection(doc), [doc]);
  return (
    <>
      <Block title="Hornhaut">
        <ReadoutRow label="Radius vorn" value={a.corneaFrontRadius2 !== undefined ? `${formatNumber(a.corneaFrontRadius, 2)} / ${formatNumber(R2, 2)} mm` : `${formatNumber(a.corneaFrontRadius, 2)} mm`} />
        <ReadoutRow label="Flächenbrechwert vorn" value={formatPower(Ff)} explain={surfaceExplain('Hornhaut vorn', 1, a.nCornea, a.corneaFrontRadius, Ff)} />
        <ReadoutRow label="Flächenbrechwert hinten" value={formatPower(Fb)} explain={surfaceExplain('Hornhaut hinten', a.nCornea, a.nAqueous, a.corneaBackRadius, Fb)} />
        <ReadoutRow label="Keratometerwert" value={a.corneaFrontRadius2 !== undefined ? `${formatPower(K1.value)} / ${formatPower(K2.value)}` : formatPower(K1.value)} explain={K1.explanation} />
        {a.corneaFrontRadius2 !== undefined && <ReadoutRow label="Hornhautastigmatismus" value={`${formatPower(Math.abs(K1.value - K2.value))} (K)`} />}
        <ReadoutRow label="Brechungsindex" value={formatNumber(a.nCornea, 3)} />
        <ReadoutRow label="Asphärizität Q" value={formatNumber(a.corneaAsphericity ?? 0, 2)} formula="Wirkt auf KL-Sitz/Fluoreszein; paraxial ohne Einfluss" />
      </Block>
      <Block title="Auge gesamt">
        <ReadoutRow label="Gesamtbrechwert" value={formatPower(sum.totalPower)} />
        <ReadoutRow label="Baulänge" value={`${formatNumber(a.axialLength, 2)} mm`} />
        {hidden ? (
          <ReadoutRow label="Refraktion" value="verborgen (Training)" />
        ) : (
          <>
            <ReadoutRow label="Refraktion am HS" value={formatRx(st.rx)} explain={explainEyeRefraction(st.meridians[0], st.meridians[1], st.rx)} />
            <ReadoutRow label="Refraktion HSA 12 mm" value={formatRx(at12)} explain={explainEffectivePower(st.rx.sph, -12, at12.sph, 'Brillenglasscheitel (HSA 12 mm)')} />
            <ReadoutRow label="Fernpunkt" value={farPoint} formula="a_R = 1/A (vom Hornhautscheitel)" />
            {st.astigmatic && <ReadoutRow label="Hauptschnitte" value={`${formatNumber(st.meridians[0].meridian, 0)}°: ${formatPower(st.meridians[0].refraction)} · ${formatNumber(st.meridians[1].meridian, 0)}°: ${formatPower(st.meridians[1].refraction)}`} explain={explainPrincipalMeridians(st.rx)} />}
            {corr.hasCorrection && <ReadoutRow label="Restrefraktion" value={formatRx(corr.residualRx)} tone="accent" />}
          </>
        )}
        <ReadoutRow label="Sturmsches Intervall" value={`${formatNumber(st.sturmIntervalMm, 2)} mm`} />
        <ReadoutRow label="Chromatische Längsaberration" value={`${formatPower(lca)} (C–F)`} formula="Augenmedien mit ν = 55,8 (chromatisches Auge)" />
        {amp !== null && <ReadoutRow label="Akkommodationsbreite" value={`${formatPower(amp)}${eye.patient?.amplitude === undefined ? ` (Hofstetter, ${eye.patient!.age} J.)` : ''}`} />}
        <ReadoutRow label="Pupille" value={`${formatNumber(a.pupilDiameter, 1)} mm`} />
      </Block>
    </>
  );
}

function LensFach({ el, doc }: { el: LensElement; doc: SceneDocument }) {
  const o = useMemo(() => lensOptics(el, doc.eye), [el, doc.eye]);
  const p = placementOf(doc.eye, el);
  const isCL = !!el.contact;
  const n = el.medium.n;
  const m = findMaterial(el.medium.presetId);
  const abbe = el.medium.abbe ?? m?.abbe;
  const eff = matrixToRx(effectivityMatrix(o.matrix, p.vertexDistance), 'minus', o.rx.axis);
  const tl = isCL && el.contact!.onEye ? tearLens(el, doc.eye) : null;
  const fluo = isCL && el.contact!.onEye && el.contact!.design === 'rigid' ? analyzeFluorescein(el, doc.eye) : null;
  const se = o.rx.sph + o.rx.cyl / 2;
  return (
    <>
      <Block title="Wirkung">
        <ReadoutRow label="Scheitelbrechwert" value={formatRx(o.rx)} explain={explainPrincipalMeridians(o.rx)} />
        {!isCL && <ReadoutRow label="HSA" value={`${formatNumber(p.vertexDistance, 2)} mm`} />}
        {!isCL && <ReadoutRow label="Wirkung am HS" value={formatRx(eff)} explain={explainEffectivePower(o.rx.sph, p.vertexDistance, eff.sph)} />}
        {p.decentration.r > 0.05 && <ReadoutRow label="Dezentration" value={`${formatNumber(p.decentration.r, 2)} mm`} />}
        <ReadoutRow label="Flächen" value={`r₁ ${formatNumber(el.lens.frontRadius, 2)} · r₂ ${formatNumber(el.lens.backRadius, 2)} mm`} />
        <ReadoutRow label="Mittendicke" value={`${formatNumber(el.lens.centerThickness, 2)} mm`} />
      </Block>
      <Block title="Material">
        <ReadoutRow label="Material" value={m?.name ?? 'benutzerdefiniert'} />
        <ReadoutRow label="n_d" value={formatNumber(n, 4)} />
        <MaterialReadouts el={el} thickness={el.lens.centerThickness} />
        {abbe && Math.abs(se) > 0.01 && (
          <ReadoutRow
            label="Farblängsfehler"
            value={formatPower(se / abbe)}
            explain={{
              title: 'Chromatische Längsaberration des Glases',
              formula: 'ΔF = F / ν',
              substitution: `ΔF = ${formatPower(se)} / ${formatNumber(abbe, 1)}`,
              result: formatPower(se / abbe),
              text: 'Unterschied der Wirkung zwischen blauem (F) und rotem (C) Licht. Bei Blick durch den Rand entsteht zusätzlich ein Farbquerfehler (Farbsäume) ≈ Prentice-Prisma / ν.',
            }}
          />
        )}
        {abbe && Math.abs(se) > 0.01 && <ReadoutRow label="Farbquerfehler 10 mm vom OZ" value={`${formatNumber((Math.abs(se) * 1) / abbe, 3)} cm/m`} formula="P_chrom = c·F/ν (Prentice / ν)" />}
      </Block>
      {tl && (
        <Block title="Kontaktlinse auf dem Auge">
          <ReadoutRow label="Tränenlinse" value={formatRx(tl.rx)} />
          <ReadoutRow label="Basiskurve / flacher K" value={`${formatNumber(tl.baseCurve, 2)} / ${formatNumber(tl.flatK, 2)} mm`} />
          <ReadoutRow label="Sitz (Radien)" value={tl.fitLabel} />
          {fluo?.applicable && <ReadoutRow label="Fluo-Bild" value={FIT_LABEL[fluo.verdict]} tone="accent" />}
          <ReadoutRow label="Tränenfilm zentral" value={`${Math.round(el.contact!.tearFilmThickness * 1000)} µm`} />
        </Block>
      )}
    </>
  );
}

export function FachPanel() {
  const doc = useAppStore((s) => s.doc);
  const selectedId = useAppStore((s) => s.selectedId);
  const entity = findEntity(doc, selectedId);
  const hidden = !!doc.training?.hidden;
  if (entity?.entityType === 'element' && entity.family === 'lens') return <LensFach el={entity} doc={doc} />;
  if (entity?.entityType === 'element')
    return (
      <Block title={entity.name}>
        <ReadoutRow label="n_d" value={formatNumber(entity.medium.n, 4)} />
        <MaterialReadouts el={entity} />
        <p className="insp-hint">Prismen, Platten und freie Medien wirken im Raytracing; für Prismen siehe Werkzeug „Prentice“.</p>
      </Block>
    );
  return (
    <>
      {!entity || entity.id === EYE_ID ? null : <p className="insp-hint" style={{ padding: '8px 12px' }}>Fachinfo zum Auge (für „{entity.name}“ keine eigenen Kennwerte).</p>}
      <EyeFach eye={doc.eye} doc={doc} hidden={hidden} />
      {hidden && <p className="insp-hint" style={{ padding: '0 12px 12px' }}>Trainingsfall aktiv: Refraktionswerte sind verborgen.</p>}
      {!hidden && doc.elements.length === 0 && <p className="insp-hint" style={{ padding: '0 12px 12px' }}>Tipp: Ein Glas auswählen zeigt Wirkung, HSA, Material und Farbfehler.</p>}
    </>
  );
}
