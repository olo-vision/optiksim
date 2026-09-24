/**
 * Bemaßungen in der Szene (Augen-lokales Koordinatensystem):
 *  - ausgewähltes Element: Hornhautscheitel → augenseitiger Scheitel (HSA), Dezentration
 *  - optional: Maßkette aller Elemente
 *  - Messpunkte: Abstand zum Hornhautscheitel
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import type { SceneDocument } from '@/model/types';
import { computeMeasurements } from '@/model/derived/measurements';
import { worldToEyeLocal } from '@/model/sceneFactory';
import { formatValue } from '@/core/units';
import { DEG2RAD } from '@/core/units';
import { isContactLens } from '@/model/elementRegistry';
import { DimensionLine } from './DimensionLine';
import { theme3d } from '../theme3d';

interface Props {
  doc: SceneDocument;
  selectedId: string | null;
  decimals: number;
}

const v = (p: readonly number[]) => new THREE.Vector3(p[0], p[1], p[2]);

export function MeasurementOverlay({ doc, selectedId, decimals }: Props) {
  const report = useMemo(() => computeMeasurements(doc), [doc]);
  const eye = doc.eye;
  const t = eye.transform;
  const baseOffsetY = -(eye.anatomy.globeRadius + 7);
  const fmt = (x: number) => formatValue(x, 'mm', Math.min(decimals, 2));

  const selected = report.placements.find((p) => p.id === selectedId);
  const selectedPoint = doc.measurePoints.find((m) => m.id === selectedId);

  return (
    <group position={t.position} rotation={[t.rotation[0] * DEG2RAD, t.rotation[1] * DEG2RAD, t.rotation[2] * DEG2RAD]} raycast={() => null}>
      {/* Maßkette */}
      {doc.display.showAllDimensions &&
        report.chain.map((c, i) => {
          const to = report.placements.find((p) => p.id === c.toId)!;
          const fromZ = c.fromId === 'eye' ? 0 : report.placements.find((p) => p.id === c.fromId)!.frontVertexLocal[2];
          const toZ = to.backVertexLocal[2];
          if (Math.abs(fromZ - toZ) < 0.05) return null;
          return (
            <DimensionLine
              key={`chain-${c.toId}`}
              from={new THREE.Vector3(0, 0, fromZ)}
              to={new THREE.Vector3(0, 0, toZ)}
              offset={new THREE.Vector3(0, baseOffsetY - 9 - (i % 2) * 0, 0)}
              label={fmt(c.gap)}
              color={theme3d.dimensionMuted}
            />
          );
        })}

      {/* Ausgewähltes Element */}
      {selected && (
        <>
          {!isContactLens(selected.element) || selected.vertexDistance > 0.2 ? (
            <DimensionLine
              from={new THREE.Vector3(0, 0, 0)}
              to={new THREE.Vector3(0, 0, selected.backVertexLocal[2])}
              offset={new THREE.Vector3(0, Math.min(baseOffsetY, selected.centerLocal[1] - 30), 0)}
              label={fmt(selected.vertexDistance)}
              sublabel={selected.element.kind === 'spectacle-lens' ? 'HSA' : 'Hornhautscheitel → Scheitel'}
              emphasis
              color={theme3d.accent}
            />
          ) : null}
          {selected.decentration.r > 0.05 && (
            <DimensionLine
              from={new THREE.Vector3(0, 0, selected.centerLocal[2])}
              to={new THREE.Vector3(selected.centerLocal[0], selected.centerLocal[1], selected.centerLocal[2])}
              offset={new THREE.Vector3(0, 0, -6)}
              label={fmt(selected.decentration.r)}
              sublabel="Dezentration"
              color={theme3d.dimension}
            />
          )}
        </>
      )}

      {/* Messpunkt */}
      {selectedPoint &&
        (() => {
          const p = worldToEyeLocal(eye, selectedPoint.transform.position);
          const dist = Math.hypot(p[0], p[1], p[2]);
          return (
            <>
              <DimensionLine from={new THREE.Vector3(0, 0, 0)} to={v(p)} offset={new THREE.Vector3(0, 0, 0)} label={fmt(dist)} sublabel="zum Hornhautscheitel" emphasis color={selectedPoint.color} />
              {Math.hypot(p[0], p[1]) > 0.05 && (
                <DimensionLine
                  from={new THREE.Vector3(0, 0, p[2])}
                  to={v(p)}
                  offset={new THREE.Vector3(0, 0, -4)}
                  label={fmt(Math.hypot(p[0], p[1]))}
                  sublabel="zur optischen Achse"
                />
              )}
            </>
          );
        })()}
    </group>
  );
}
