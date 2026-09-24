/**
 * Prozedurale Texturen für das Augenmodell (keine externen Bilddateien nötig).
 */
import * as THREE from 'three';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * (f > 1 ? 0.9 : 1.05)), Math.max(0, Math.min(1, hsl.l * f)));
  return `#${c.getHexString()}`;
}

/**
 * Iris-Textur für RingGeometry (planares UV: Canvas-Radius 0.5 = Außenradius).
 */
export function createIrisTexture(color: string, pupilRatio: number, size = 512): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const c = size / 2;
  const R = size / 2;
  const r0 = R * pupilRatio;
  const rand = rng(1337);

  // Grundfarbe
  const g = ctx.createRadialGradient(c, c, r0, c, c, R);
  g.addColorStop(0, shade(color, 0.55));
  g.addColorStop(0.18, shade('#8a5a2b', 0.9)); // Krause (Collarette) leicht bräunlich
  g.addColorStop(0.32, shade(color, 1.0));
  g.addColorStop(0.75, shade(color, 0.85));
  g.addColorStop(0.93, shade(color, 0.45));
  g.addColorStop(1, '#10141a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.fill();

  // radiale Fasern (Trabekel)
  const fibers = 520;
  for (let i = 0; i < fibers; i++) {
    const a = (i / fibers) * Math.PI * 2 + rand() * 0.02;
    const start = r0 * (1.02 + rand() * 0.1);
    const end = R * (0.78 + rand() * 0.18);
    const wobble = (rand() - 0.5) * 0.05;
    const light = rand() > 0.55;
    ctx.strokeStyle = light ? shade(color, 1.35 + rand() * 0.35) : shade(color, 0.55 + rand() * 0.2);
    ctx.globalAlpha = 0.18 + rand() * 0.28;
    ctx.lineWidth = 0.6 + rand() * 1.4;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * start, c + Math.sin(a) * start);
    const mid = (start + end) / 2;
    ctx.quadraticCurveTo(c + Math.cos(a + wobble) * mid, c + Math.sin(a + wobble) * mid, c + Math.cos(a) * end, c + Math.sin(a) * end);
    ctx.stroke();
  }
  // Krypten
  for (let i = 0; i < 38; i++) {
    const a = rand() * Math.PI * 2;
    const rr = r0 + (R * 0.72 - r0) * (0.15 + rand() * 0.8);
    ctx.globalAlpha = 0.25 + rand() * 0.25;
    ctx.fillStyle = shade(color, 0.35);
    ctx.beginPath();
    ctx.ellipse(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 1.5 + rand() * 4, 4 + rand() * 9, a, 0, Math.PI * 2);
    ctx.fill();
  }
  // Krausenring
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = shade('#a06a35', 1.1);
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    const rr = r0 + (R - r0) * 0.3 + Math.sin(a * 11) * 3 + Math.sin(a * 5) * 2;
    const x = c + Math.cos(a) * rr;
    const y = c + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Pupillarsaum
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#1a0f0a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, r0 + 1.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#020203';
  ctx.beginPath();
  ctx.arc(c, c, r0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Sklera-Textur für LatheGeometry (u = Umfang, v = Profil ab Limbus).
 */
export function createScleraTexture(width = 1024, height = 512): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d')!;
  const rand = rng(4242);
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, '#e9e1d8');
  g.addColorStop(0.12, '#f3eee8');
  g.addColorStop(0.6, '#f1ece6');
  g.addColorStop(1, '#e2dcd6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // feine Gefäße (vom Äquator Richtung Limbus)
  const branch = (x: number, y: number, angle: number, len: number, w: number, depth: number) => {
    if (depth <= 0 || len < 4) return;
    let px = x, py = y;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(px, py);
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      angle += (rand() - 0.5) * 0.5;
      px += Math.cos(angle) * (len / steps);
      py += Math.sin(angle) * (len / steps);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    if (rand() > 0.35) branch(px, py, angle + (rand() - 0.5) * 1.2, len * 0.6, w * 0.7, depth - 1);
    if (rand() > 0.55) branch(px, py, angle + (rand() - 0.5) * 1.4, len * 0.5, w * 0.6, depth - 1);
  };
  for (let i = 0; i < 26; i++) {
    const x = rand() * width;
    const y = height * (0.28 + rand() * 0.2);
    ctx.strokeStyle = `rgba(${150 + rand() * 40}, ${40 + rand() * 30}, ${40 + rand() * 20}, ${0.12 + rand() * 0.16})`;
    branch(x, y, -Math.PI / 2 + (rand() - 0.5) * 0.6, 60 + rand() * 80, 1.4 + rand(), 4);
  }
  // Limbusnahe Rötung (sehr dezent)
  const lg = ctx.createLinearGradient(0, 0, 0, height * 0.08);
  lg.addColorStop(0, 'rgba(170,120,110,0.18)');
  lg.addColorStop(1, 'rgba(170,120,110,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, width, height * 0.08);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.flipY = false; // v = 0 am Limbus
  tex.anisotropy = 4;
  return tex;
}
