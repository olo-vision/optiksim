/**
 * Parametrisches Modellauge.
 * Lokales System: Ursprung = Hornhautscheitel, +Z zeigt ins Auge (Lichtrichtung).
 * Ansichten: „Normal“ (äußere Ansicht) und „Schnitt“ (Halbschnitt mit Beschriftung).
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { EyeEntity, EyePartId } from '@/model/types';
import { computeEyeGeometry, ellipsePoint, type Ellipse } from '@/model/derived/eyeGeometry';
import { sag } from '@/core/math/surfaces';
import { DEG2RAD } from '@/core/units';
import { useAppStore } from '@/state/store';
import { buildLatheZ, buildLensGeometry } from '../elements/geometry/lensGeometry';
import { createIrisTexture, createScleraTexture } from './eyeTextures';
import { registerRef } from '../interaction/objectRegistry';
import { selectableHandlers, useHoverStore } from '../interaction/hover';
import { SelectionBracket } from '../interaction/SelectionBracket';
import { EyeLabels } from './EyeLabels';
import { corneaSpec } from '@/model/derived/effectiveLens';

function ellipseProfile(e: Ellipse, t0: number, t1: number, steps = 64, inset = 0) {
  const pts: Array<{ h: number; z: number }> = [];
  const ee = { a: e.a - inset, b: e.b - inset, zc: e.zc };
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    pts.push(ellipsePoint(ee, t));
  }
  pts[pts.length - 1] = { h: 0, z: pts[pts.length - 1].z };
  return pts;
}

const partOf = (e: ThreeEvent<PointerEvent>) => e.object.userData.part as EyePartId | undefined;

export const EyeModel = memo(function EyeModel({ eye }: { eye: EyeEntity }) {
  const a = eye.anatomy;
  const g = useMemo(() => computeEyeGeometry(a), [a]);
  const section = eye.viewMode === 'section';
  const selected = useAppStore((s) => s.selectedId === eye.id);
  const hoverPart = useHoverStore((s) => (s.target?.entityId === eye.id ? s.target.part : undefined));
  const quality = useAppStore((s) => s.prefs.quality);
  const handlers = useMemo(() => selectableHandlers(eye.id, partOf), [eye.id]);
  const ref = useMemo(() => registerRef(eye.id), [eye.id]);
  const groupRef = useRef<THREE.Group>(null);

  /* ------------------------------ Geometrie ------------------------------ */
  const geo = useMemo(() => {
    const sclera = buildLatheZ(ellipseProfile(g.sclera, g.scleraLimbusT, Math.PI, 72), 128);
    const uvea = buildLatheZ(ellipseProfile(g.sclera, g.scleraLimbusT + 0.08, Math.PI, 64, 0.45), 96);
    const retina = buildLatheZ(ellipseProfile(g.retina, g.retinaStartT, Math.PI, 56), 96);
    const vitreous = buildLatheZ(
      [{ h: 0, z: g.lens.backZ + 0.3 }, { h: g.lens.semiAperture * 0.9, z: g.lens.backZ - 1.2 }, ...ellipseProfile(g.retina, g.retinaStartT + 0.05, Math.PI, 48, 0.2)],
      80,
    );
    const cornea = buildLensGeometry({
      frontSpec: corneaSpec(eye),
      R1: a.corneaFrontRadius,
      R2: a.corneaBackRadius,
      thickness: a.corneaThickness,
      outline: () => g.limbus.h,
      zOffset: a.corneaThickness / 2,
      radialSegments: 28,
      angularSegments: 128,
    });
    // Kammerwasser: Hornhautrückfläche → Irisebene
    const aq: Array<{ h: number; z: number }> = [];
    const hb = Math.min(g.corneaBackMaxH, g.iris.outerR);
    for (let i = 0; i <= 24; i++) {
      const h = (hb * i) / 24;
      aq.push({ h, z: a.corneaThickness + sag(a.corneaBackRadius, h) + 0.02 });
    }
    aq.push({ h: g.iris.outerR, z: g.iris.z - 0.05 });
    aq.push({ h: 0, z: g.iris.z - 0.05 });
    const aqueous = buildLatheZ(aq.reverse().map((p) => ({ ...p })), 96);
    const lens = buildLensGeometry({
      R1: a.lensFrontRadius,
      R2: a.lensBackRadius,
      thickness: a.lensThickness,
      outline: () => g.lens.semiAperture,
      zOffset: g.lens.frontZ + a.lensThickness / 2,
      radialSegments: 20,
      angularSegments: 96,
    });
    const iris = new THREE.RingGeometry(g.iris.innerR, g.iris.outerR, 128, 3);
    const irisBack = new THREE.RingGeometry(g.iris.innerR + 0.05, g.iris.outerR, 96, 1);
    const pupil = new THREE.CircleGeometry(g.iris.innerR, 48);
    return { sclera, uvea, retina, vitreous, cornea, aqueous, lens, iris, irisBack, pupil };
  }, [a, g]);

  useEffect(() => () => Object.values(geo).forEach((x) => x.dispose()), [geo]);

  const irisTex = useMemo(() => createIrisTexture(eye.irisColor, g.iris.innerR / g.iris.outerR), [eye.irisColor, g.iris.innerR, g.iris.outerR]);
  useEffect(() => () => irisTex.dispose(), [irisTex]);
  const scleraTex = useMemo(() => createScleraTexture(), []);
  useEffect(() => () => scleraTex.dispose(), [scleraTex]);

  /* --------------------------- Schnittebene ----------------------------- */
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), []);
  const clip = useMemo(() => (section ? [plane] : []), [section, plane]);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const tmp = useMemo(() => ({ n: new THREE.Vector3(), p: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion() }), []);

  // Schnitt immer auf der der Kamera zugewandten Seite öffnen
  useFrame(() => {
    if (!section || !groupRef.current) return;
    const grp = groupRef.current;
    grp.getWorldQuaternion(tmp.q);
    grp.getWorldPosition(tmp.p);
    tmp.n.set(1, 0, 0).applyQuaternion(tmp.q);
    tmp.c.copy(camera.position).sub(tmp.p);
    const side = tmp.c.dot(tmp.n) > 0 ? -1 : 1;
    tmp.n.multiplyScalar(side);
    const constant = -tmp.n.dot(tmp.p);
    if (!plane.normal.equals(tmp.n) || Math.abs(plane.constant - constant) > 1e-6) {
      plane.normal.copy(tmp.n);
      plane.constant = constant;
      invalidate();
    }
  });

  const hl = (part: EyePartId) => (hoverPart === part ? 0.12 : 0);
  const transmission = quality !== 'performance';
  const box = useMemo(
    () => new THREE.Box3(new THREE.Vector3(-a.globeRadius, -a.globeRadius, -0.2), new THREE.Vector3(a.globeRadius, a.globeRadius, a.axialLength + 1)),
    [a.globeRadius, a.axialLength],
  );

  const t = eye.transform;
  return (
    <group
      ref={(o) => {
        groupRef.current = o;
        ref(o);
      }}
      name="Auge"
      visible={eye.visible}
      position={t.position}
      rotation={[t.rotation[0] * DEG2RAD, t.rotation[1] * DEG2RAD, t.rotation[2] * DEG2RAD]}
      userData={{ entityId: eye.id }}
      {...handlers}
    >
      {/* Sklera */}
      <mesh geometry={geo.sclera} userData={{ part: 'sclera' }} castShadow receiveShadow>
        <meshPhysicalMaterial
          map={scleraTex}
          color="#ffffff"
          roughness={0.42}
          clearcoat={0.9}
          clearcoatRoughness={0.18}
          sheen={0.3}
          sheenColor="#ffe6e0"
          emissive="#4cc2ff"
          emissiveIntensity={hl('sclera')}
          side={THREE.DoubleSide}
          clippingPlanes={clip}
          clipShadows
        />
      </mesh>
      {/* Innere Augenhäute (Aderhaut) – verhindert „durchsichtigen“ Augapfel durch die Pupille */}
      <mesh geometry={geo.uvea} raycast={() => null}>
        <meshStandardMaterial color={section ? '#5a2419' : '#140605'} roughness={0.9} side={THREE.BackSide} clippingPlanes={clip} />
      </mesh>
      {/* Retina */}
      <mesh geometry={geo.retina} userData={{ part: 'retina' }}>
        <meshStandardMaterial
          color={section ? '#d0583a' : '#2a0b07'}
          emissive={section ? '#5a1406' : '#000000'}
          emissiveIntensity={section ? 0.35 + hl('retina') * 3 : 0}
          roughness={0.7}
          side={THREE.DoubleSide}
          clippingPlanes={clip}
        />
      </mesh>
      {/* Glaskörper (nur Schnitt) */}
      {section && (
        <mesh geometry={geo.vitreous} userData={{ part: 'vitreous' }} renderOrder={1}>
          <meshStandardMaterial color="#9fd8ff" transparent opacity={0.07 + hl('vitreous')} depthWrite={false} side={THREE.DoubleSide} clippingPlanes={clip} />
        </mesh>
      )}
      {/* Vorderkammer (nur Schnitt) */}
      {section && (
        <mesh geometry={geo.aqueous} userData={{ part: 'anterior-chamber' }} renderOrder={1}>
          <meshStandardMaterial color="#8fe3ff" transparent opacity={0.12 + hl('anterior-chamber')} depthWrite={false} side={THREE.DoubleSide} clippingPlanes={clip} />
        </mesh>
      )}
      {/* Iris */}
      <mesh geometry={geo.iris} position={[0, 0, g.iris.z]} rotation={[0, Math.PI, 0]} userData={{ part: 'iris' }}>
        <meshStandardMaterial
          map={irisTex}
          roughness={0.55}
          side={THREE.DoubleSide}
          emissive="#4cc2ff"
          emissiveIntensity={hl('iris')}
          clippingPlanes={clip}
        />
      </mesh>
      <mesh geometry={geo.irisBack} position={[0, 0, g.iris.z + 0.3]} raycast={() => null}>
        <meshStandardMaterial color="#1b0e08" roughness={0.9} side={THREE.DoubleSide} clippingPlanes={clip} />
      </mesh>
      {/* Pupille – unsichtbare Trefferfläche für Hover/Info */}
      <mesh geometry={geo.pupil} position={[0, 0, g.iris.z - 0.01]} userData={{ part: 'pupil' }}>
        <meshBasicMaterial transparent opacity={hoverPart === 'pupil' ? 0.12 : 0} color="#4cc2ff" depthWrite={false} />
      </mesh>
      {/* Augenlinse */}
      <mesh geometry={geo.lens} userData={{ part: 'lens' }} renderOrder={2}>
        <meshPhysicalMaterial
          color={section ? '#ffe9b8' : '#fff6e0'}
          transmission={transmission ? 0.9 : 0}
          transparent={!transmission}
          opacity={transmission ? 1 : 0.45}
          roughness={0.08}
          ior={a.nLens}
          thickness={a.lensThickness}
          emissive="#4cc2ff"
          emissiveIntensity={hl('lens')}
          side={THREE.DoubleSide}
          clippingPlanes={clip}
        />
      </mesh>
      {/* Hornhaut */}
      <mesh geometry={geo.cornea} userData={{ part: 'cornea' }} renderOrder={3}>
        <meshPhysicalMaterial
          color="#f4fbff"
          transmission={transmission ? 1 : 0}
          transparent={!transmission}
          opacity={transmission ? 1 : 0.2}
          roughness={0}
          ior={a.nCornea}
          thickness={0.6}
          clearcoat={1}
          clearcoatRoughness={0}
          specularIntensity={1}
          envMapIntensity={1.6}
          emissive="#4cc2ff"
          emissiveIntensity={hl('cornea') * 0.6}
          side={THREE.DoubleSide}
          clippingPlanes={clip}
        />
      </mesh>
      {/* Limbus-Übergang */}
      <mesh position={[0, 0, g.limbus.z + 0.15]} raycast={() => null}>
        <torusGeometry args={[g.limbus.h + 0.05, 0.28, 12, 128]} />
        <meshStandardMaterial color="#8c969c" transparent opacity={0.55} roughness={0.5} clippingPlanes={clip} />
      </mesh>

      {section && eye.showLabels && <EyeLabels anatomy={a} geometry={g} />}
      {selected && <SelectionBracket box={box} />}
    </group>
  );
});
