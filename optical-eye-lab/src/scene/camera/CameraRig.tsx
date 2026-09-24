/**
 * Kamera-System: perspektivische und orthografische Kamera mit gemeinsamer
 * CAD-Steuerung (camera-controls).
 *
 * Maus:  links = Auswahl · rechts = Orbit · Mitte = Verschieben · Rad = Zoom
 *        Alt + links = Orbit · Umschalt + links = Verschieben (Trackpad-freundlich)
 * Befehle (Fokus, Ansichten, Reset) kommen als `cameraCommand` aus dem Store.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CameraControls, CameraControlsImpl, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useAppStore, findEntity } from '@/state/store';
import { makeRigid, toWorldDir, toWorldPoint } from '@/core/math/vec';
import { useObjectRegistry } from '../interaction/objectRegistry';
import { EYE_ID } from '@/model/types';

const FOV = 32;
const { ACTION } = CameraControlsImpl;

type Controls = CameraControlsImpl;

function eyeFrame() {
  const eye = useAppStore.getState().doc.eye;
  const rigid = makeRigid(eye.transform.position, eye.transform.rotation);
  return {
    apex: new THREE.Vector3(...toWorldPoint(rigid, [0, 0, 0])),
    center: new THREE.Vector3(...toWorldPoint(rigid, [0, 0, eye.anatomy.axialLength / 2])),
    axis: new THREE.Vector3(...toWorldDir(rigid, [0, 0, 1])).normalize(),
    x: new THREE.Vector3(...toWorldDir(rigid, [1, 0, 0])).normalize(),
    y: new THREE.Vector3(...toWorldDir(rigid, [0, 1, 0])).normalize(),
  };
}

export function defaultCameraPose() {
  const f = eyeFrame();
  const target = f.apex.clone().addScaledVector(f.axis, -14).addScaledVector(f.y, -4);
  const dir = new THREE.Vector3()
    .addScaledVector(f.x, -1.35)
    .addScaledVector(f.y, 0.38)
    .addScaledVector(f.axis, -0.72)
    .normalize();
  return { position: target.clone().addScaledVector(dir, 185), target };
}

function sceneBox(): THREE.Box3 {
  const { doc } = useAppStore.getState();
  const reg = useObjectRegistry.getState().objects;
  const box = new THREE.Box3();
  const ids = [EYE_ID, ...doc.elements.filter((e) => e.visible).map((e) => e.id), ...doc.lights.filter((l) => l.visible).map((l) => l.id)];
  for (const id of ids) {
    const o = reg.get(id);
    if (o) box.union(new THREE.Box3().setFromObject(o));
  }
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(40, 40, 40));
  return box;
}

/** Freier Bühnenbereich (Canvas minus Panels/Leisten) in Pixeln. */
function stageRect(canvas: HTMLCanvasElement) {
  const c = canvas.getBoundingClientRect();
  let left = c.left;
  let right = c.right;
  let top = c.top;
  let bottom = c.bottom;
  const lp = document.querySelector('.panel--left')?.getBoundingClientRect();
  const rp = document.querySelector('.panel--right')?.getBoundingClientRect();
  const tb = document.querySelector('.viewbar')?.getBoundingClientRect() ?? document.querySelector('.toolbar')?.getBoundingClientRect();
  const mb = document.querySelector('.measure-bar')?.getBoundingClientRect() ?? document.querySelector('.statusbar')?.getBoundingClientRect();
  if (lp) left = Math.max(left, lp.right);
  if (rp) right = Math.min(right, rp.left);
  if (tb) top = Math.max(top, tb.bottom);
  if (mb) bottom = Math.min(bottom, mb.top);
  const w = Math.max(120, right - left);
  const h = Math.max(120, bottom - top);
  return {
    width: c.width > 0 ? c.width : 1,
    height: c.height > 0 ? c.height : 1,
    cw: c.width,
    ch: c.height,
    freeW: w,
    freeH: h,
    // Versatz der Bühnenmitte gegenüber der Canvasmitte (px, +x rechts, +y unten)
    dx: left + w / 2 - (c.left + c.width / 2),
    dy: top + h / 2 - (c.top + c.height / 2),
  };
}

/**
 * Passt eine Kugel in die freie Bühne ein (berücksichtigt Seitenpanels und Leisten),
 * bei beibehaltener Blickrichtung.
 */
function fitSphereToStage(controls: Controls, sphere: THREE.Sphere, canvas: HTMLCanvasElement, margin = 1.08) {
  const cam = controls.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  const st = stageRect(canvas);
  const pos = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  controls.getPosition(pos);
  controls.getTarget(tgt);
  const dir = pos.clone().sub(tgt).normalize();
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  const camUp = new THREE.Vector3().crossVectors(dir, right).normalize();
  const r = sphere.radius * margin;

  if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
    const zoom = Math.min(st.freeW, st.freeH) / (2 * r);
    const wpp = 1 / zoom;
    const target = sphere.center.clone().addScaledVector(right, -st.dx * wpp).addScaledVector(camUp, st.dy * wpp);
    const p = target.clone().addScaledVector(dir, 1200);
    void controls.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, true);
    void controls.zoomTo(zoom, true);
    return;
  }
  const pc = cam as THREE.PerspectiveCamera;
  const tanV = Math.tan(THREE.MathUtils.degToRad(pc.fov / 2));
  const vf = Math.atan(tanV * (st.freeH / st.ch));
  const hf = Math.atan(tanV * pc.aspect * (st.freeW / st.cw));
  const d = r / Math.sin(Math.min(vf, hf));
  const wpp = (2 * d * tanV) / st.ch;
  const target = sphere.center.clone().addScaledVector(right, -st.dx * wpp).addScaledVector(camUp, st.dy * wpp);
  const p = target.clone().addScaledVector(dir, d);
  void controls.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, true);
}

/** Kamerapose überdauert das Neuerzeugen des Canvas (z. B. beim Wechsel der Qualitätsstufe). */
const savedPose: { current: { pos: THREE.Vector3; target: THREE.Vector3; zoom: number; projection: string } | null } = { current: null };

export function CameraRig() {
  const projection = useAppStore((s) => s.projection);
  const rotateSpeed = useAppStore((s) => s.prefs.cameraRotateSpeed);
  const zoomSpeed = useAppStore((s) => s.prefs.zoomSpeed);
  const command = useAppStore((s) => s.cameraCommand);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const canvas = useThree((s) => s.gl.domElement);
  const [controls, setControls] = useState<Controls | null>(null);
  const saved = savedPose;
  const lastCommandNonce = useRef(0);

  // Maus- und Touch-Belegung
  const configureButtons = useCallback(
    (c: Controls, mod: 'none' | 'alt' | 'shift') => {
      c.mouseButtons.left = mod === 'alt' ? ACTION.ROTATE : mod === 'shift' ? ACTION.TRUCK : ACTION.NONE;
      c.mouseButtons.right = ACTION.ROTATE;
      c.mouseButtons.middle = ACTION.TRUCK;
      c.mouseButtons.wheel = projection === 'perspective' ? ACTION.DOLLY : ACTION.ZOOM;
      c.touches.one = ACTION.TOUCH_ROTATE;
      c.touches.two = projection === 'perspective' ? ACTION.TOUCH_DOLLY_TRUCK : ACTION.TOUCH_ZOOM_TRUCK;
      c.touches.three = ACTION.TOUCH_TRUCK;
    },
    [projection],
  );

  // Geschwindigkeiten aus den Benutzereinstellungen
  useEffect(() => {
    if (!controls) return;
    controls.dollySpeed = zoomSpeed;
    controls.azimuthRotateSpeed = rotateSpeed;
    controls.polarRotateSpeed = rotateSpeed;
  }, [controls, rotateSpeed, zoomSpeed]);

  useEffect(() => {
    if (!controls) return;
    configureButtons(controls, 'none');
    controls.dollyToCursor = true;
    controls.smoothTime = 0.16;
    controls.draggingSmoothTime = 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 4000;
    controls.minZoom = 0.2;
    controls.maxZoom = 400;

    const onKey = (e: KeyboardEvent) => configureButtons(controls, e.altKey ? 'alt' : e.shiftKey ? 'shift' : 'none');
    const onBlur = () => configureButtons(controls, 'none');
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);

    const onUpdate = () => {
      const cam = controls.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
      const pos = new THREE.Vector3();
      const target = new THREE.Vector3();
      controls.getPosition(pos);
      controls.getTarget(target);
      saved.current = { pos, target, zoom: cam.zoom, projection: (cam as THREE.OrthographicCamera).isOrthographicCamera ? 'orthographic' : 'perspective' };
    };
    controls.addEventListener('update', onUpdate);

    // Pose aus der vorherigen Kamera übernehmen (Projektionswechsel) oder Standardpose
    const prev = saved.current;
    const isOrtho = projection === 'orthographic';
    if (!prev) {
      const p = defaultCameraPose();
      controls.setLookAt(p.position.x, p.position.y, p.position.z, p.target.x, p.target.y, p.target.z, false);
    } else if (prev.projection !== projection) {
      const dir = prev.pos.clone().sub(prev.target);
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      if (isOrtho) {
        const dist = dir.length();
        const zoom = size.height / (2 * dist * tanHalf);
        const pos = prev.target.clone().addScaledVector(dir.normalize(), 1200);
        controls.setLookAt(pos.x, pos.y, pos.z, prev.target.x, prev.target.y, prev.target.z, false);
        controls.zoomTo(zoom, false);
      } else {
        const dist = size.height / (2 * Math.max(prev.zoom, 0.01) * tanHalf);
        const pos = prev.target.clone().addScaledVector(dir.normalize(), dist);
        controls.zoomTo(1, false);
        controls.setLookAt(pos.x, pos.y, pos.z, prev.target.x, prev.target.y, prev.target.z, false);
      }
    } else {
      controls.setLookAt(prev.pos.x, prev.pos.y, prev.pos.z, prev.target.x, prev.target.y, prev.target.z, false);
      if (isOrtho) controls.zoomTo(prev.zoom, false);
    }
    onUpdate();
    invalidate();

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
      controls.removeEventListener('update', onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls]);

  // Kamera-Befehle
  useEffect(() => {
    if (!controls || !command || command.nonce === lastCommandNonce.current) return;
    lastCommandNonce.current = command.nonce;
    const run = () => {
      switch (command.type) {
        case 'reset': {
          const p = defaultCameraPose();
          controls.zoomTo(1, true);
          controls.setLookAt(p.position.x, p.position.y, p.position.z, p.target.x, p.target.y, p.target.z, true);
          break;
        }
        case 'focus-eye': {
          const f = eyeFrame();
          const eye = useAppStore.getState().doc.eye;
          fitSphereToStage(controls, new THREE.Sphere(f.center, eye.anatomy.globeRadius * (eye.viewMode === 'section' && eye.showLabels ? 1.6 : 1.3)), canvas);
          break;
        }
        case 'focus-scene': {
          fitSphereToStage(controls, sceneBox().getBoundingSphere(new THREE.Sphere()), canvas, 1.0);
          break;
        }
        case 'focus-selection': {
          const { selectedId, doc } = useAppStore.getState();
          const o = selectedId ? useObjectRegistry.getState().objects.get(selectedId) : undefined;
          if (!o || !findEntity(doc, selectedId)) {
            fitSphereToStage(controls, sceneBox().getBoundingSphere(new THREE.Sphere()), canvas, 1.0);
            break;
          }
          const s = new THREE.Box3().setFromObject(o).getBoundingSphere(new THREE.Sphere());
          s.radius = Math.max(s.radius * 1.2, 6);
          fitSphereToStage(controls, s, canvas);
          break;
        }
        case 'view': {
          const f = eyeFrame();
          const target = new THREE.Vector3();
          controls.getTarget(target);
          const pos = new THREE.Vector3();
          controls.getPosition(pos);
          const dist = Math.max(40, pos.distanceTo(target));
          const dir =
            command.view === 'front'
              ? f.axis.clone().negate()
              : command.view === 'side'
                ? f.x.clone().negate()
                : f.y.clone().addScaledVector(f.axis, -0.0005).normalize();
          const p = target.clone().addScaledVector(dir, dist);
          void controls.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, true);
          break;
        }
      }
      invalidate();
    };
    // Registry muss nach Szenenwechsel erst befüllt sein
    requestAnimationFrame(run);
  }, [command, controls, invalidate, canvas]);

  return (
    <>
      <PerspectiveCamera makeDefault={projection === 'perspective'} fov={FOV} near={0.5} far={20000} position={[-160, 70, -190]} />
      <OrthographicCamera makeDefault={projection === 'orthographic'} near={-20000} far={20000} position={[-160, 70, -190]} zoom={4} />
      <CameraControls ref={setControls as never} makeDefault />
    </>
  );
}
