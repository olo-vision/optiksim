/**
 * 3D-Viewport: Canvas, Renderer-Einstellungen und Szenen-Komposition.
 * Rendert „on demand“ – nur bei Änderungen –, um GPU und Akku zu schonen.
 */
import { Suspense, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/store';
import { CameraRig } from './camera/CameraRig';
import { Lighting } from './environment/Lighting';
import { LabRoom } from './environment/LabRoom';
import { OpticalBench } from './environment/OpticalBench';
import { EyeModel } from './eye/EyeModel';
import { OpticalElementView } from './elements/OpticalElementView';
import { TearFilmView } from './elements/TearFilmView';
import { isOnEye } from '@/model/derived/contactSeat';
import { LightSourceView, MeasurePointView } from './overlays/SceneMarkers';
import { OpticalAxis } from './overlays/OpticalAxis';
import { MeasurementOverlay } from './overlays/MeasurementOverlay';
import { RayView } from './overlays/RayView';
import { TransformGizmo, gizmoState } from './interaction/TransformGizmo';
import { useHoverStore } from './interaction/hover';
import { LabelLayer, LabelProjector } from './labels/labels';
import { DevHooks } from './DevHooks';
import { ThumbnailCapture } from './thumbnail';

function SceneContent() {
  const doc = useAppStore((s) => s.doc);
  const selectedId = useAppStore((s) => s.selectedId);
  const prefs = useAppStore((s) => s.prefs);
  const eyePos = doc.eye.transform.position;
  const high = prefs.quality === 'high';

  const frontLength = useMemo(() => {
    let m = 160;
    for (const e of doc.elements) m = Math.max(m, eyePos[2] - e.transform.position[2] + 60);
    for (const l of doc.lights) m = Math.max(m, eyePos[2] - l.transform.position[2] + 20);
    return m;
  }, [doc.elements, doc.lights, eyePos]);

  return (
    <>
      <CameraRig />
      <Lighting target={eyePos} shadows={prefs.quality !== 'performance' && prefs.shadows} exposure={doc.environment.exposure} />
      <LabRoom settings={doc.environment} reflections={high && prefs.reflections && doc.environment.reflections} center={[eyePos[0], eyePos[2] - 60]} />
      {doc.environment.showBench && <OpticalBench doc={doc} />}

      <EyeModel eye={doc.eye} />
      {doc.elements.map((el) => (
        <OpticalElementView key={el.id} el={el} eye={doc.eye} />
      ))}
      {doc.eye.visible &&
        doc.elements.map((el) =>
          el.visible && isOnEye(el) && (el.contact!.tearFilm ?? true) ? <TearFilmView key={`tear-${el.id}`} el={el} eye={doc.eye} /> : null,
        )}
      {doc.lights.map((l) => (
        <LightSourceView key={l.id} light={l} />
      ))}
      {doc.measurePoints.map((m) => (
        <MeasurePointView key={m.id} point={m} />
      ))}

      {doc.display.showOpticalAxis && doc.eye.visible && <OpticalAxis eye={doc.eye} frontLength={frontLength} />}
      {doc.display.showDimensions && <MeasurementOverlay doc={doc} selectedId={selectedId} decimals={prefs.decimals} />}
      {doc.display.showRays && <RayView doc={doc} />}

      <TransformGizmo />
      <LabelProjector />
      <ThumbnailCapture />
      {import.meta.env.DEV && <DevHooks />}
    </>
  );
}

export function Viewport() {
  const quality = useAppStore((s) => s.prefs.quality);
  const maxDpr = useAppStore((s) => s.prefs.maxPixelRatio);
  const antialias = useAppStore((s) => s.prefs.antialias);
  const shadowsPref = useAppStore((s) => s.prefs.shadows);
  const down = useRef<{ x: number; y: number } | null>(null);
  const dpr: [number, number] = [1, Math.min(maxDpr, quality === 'high' ? 2 : quality === 'balanced' ? 1.5 : 1)];
  const shadows = quality !== 'performance' && shadowsPref;

  return (
    <div
      className="viewport"
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
      onContextMenu={(e) => e.preventDefault()}
      onPointerLeave={() => useHoverStore.getState().setTarget(null)}
    >
      <Canvas
        key={`${shadows ? 'sh' : 'nosh'}-${antialias ? 'aa' : 'noaa'}`}
        frameloop="demand"
        shadows={shadows ? { type: THREE.PCFShadowMap } : false}
        dpr={dpr}
        gl={{ antialias, powerPreference: 'high-performance', localClippingEnabled: true } as THREE.WebGLRendererParameters & { localClippingEnabled: boolean }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
        onPointerMissed={(e) => {
          if (e.button !== 0) return;
          const d = down.current;
          const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 : false;
          const recentDrag = performance.now() - gizmoState.lastDragEnd < 250;
          if (moved || recentDrag || gizmoState.axisHovered || gizmoState.dragging) return;
          useAppStore.getState().select(null);
        }}
      >
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
      <LabelLayer />
    </div>
  );
}
