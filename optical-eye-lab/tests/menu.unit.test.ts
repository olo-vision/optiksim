/**
 * Dropdown-Menüs bleiben vollständig im sichtbaren Bereich (Account-Menü oben rechts im Simulator,
 * Drei-Punkte-Menü in Simulationskarten, Benutzermenü unten in der Seitenleiste).
 */
import { describe, expect, it } from 'vitest';
import { computeMenuPosition } from '@/ui/common/overlays';

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080 },
  laptop: { width: 1366, height: 768 },
  tabletPortrait: { width: 768, height: 1024 },
  tabletLandscape: { width: 1024, height: 768 },
  phone: { width: 390, height: 844 },
  smallPhone: { width: 320, height: 568 },
};

const inside = (p: ReturnType<typeof computeMenuPosition>, vp: { width: number; height: number }, contentH: number) => {
  const h = Math.min(contentH, p.maxHeight);
  return p.left >= 8 && p.top >= 8 && p.left + p.width <= vp.width - 8 && p.top + h <= vp.height - 8;
};

describe('computeMenuPosition', () => {
  it('Account-Button oben rechts: klappt nach links auf und bleibt in allen Viewports sichtbar', () => {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      // runder Button 34 px, 10 px vom rechten Rand – auch wenn das Menü (falsch) links ausgerichtet angefordert wird
      const anchor = { top: 10, bottom: 44, left: vp.width - 44, right: vp.width - 10 };
      for (const align of ['left', 'right'] as const) {
        const p = computeMenuPosition(anchor, { width: 250, height: 330 }, vp, align, 'down');
        expect(inside(p, vp, 330), `${name}/${align}`).toBe(true);
        expect(p.left + p.width, `${name}/${align}: rechte Kante`).toBeLessThanOrEqual(vp.width - 8);
        expect(p.up).toBe(false);
      }
      // rechtsbündig: rechte Menükante sitzt an der rechten Button-Kante
      const r = computeMenuPosition(anchor, { width: 250, height: 330 }, vp, 'right', 'down');
      expect(r.left + r.width).toBe(Math.min(anchor.right, vp.width - 8));
    }
  });

  it('breiter als der Bildschirm: Breite wird begrenzt', () => {
    const vp = VIEWPORTS.smallPhone;
    const p = computeMenuPosition({ top: 10, bottom: 40, left: 280, right: 310 }, { width: 400, height: 200 }, vp, 'right', 'down');
    expect(p.width).toBe(vp.width - 16);
    expect(p.left).toBe(8);
  });

  it('zu hoch für den Platz darunter: öffnet nach oben, wenn dort mehr Platz ist, sonst Scrollen im Menü', () => {
    const vp = VIEWPORTS.laptop;
    const low = computeMenuPosition({ top: 700, bottom: 730, left: 100, right: 130 }, { width: 230, height: 420 }, vp, 'right', 'down');
    expect(low.up).toBe(true);
    expect(inside(low, vp, 420)).toBe(true);
    const tall = computeMenuPosition({ top: 10, bottom: 44, left: 100, right: 130 }, { width: 230, height: 2000 }, vp, 'left', 'down');
    expect(tall.up).toBe(false);
    expect(tall.maxHeight).toBeLessThan(2000);
    expect(inside(tall, vp, 2000)).toBe(true);
  });

  it('Seitenleisten-Menü (direction up) bleibt nach oben, solange Platz ist', () => {
    const vp = VIEWPORTS.desktop;
    const p = computeMenuPosition({ top: 1000, bottom: 1050, left: 12, right: 240 }, { width: 250, height: 300 }, vp, 'left', 'up');
    expect(p.up).toBe(true);
    expect(p.left).toBe(12);
    expect(inside(p, vp, 300)).toBe(true);
  });

  it('Auslöser nahe dem linken Rand bei rechter Ausrichtung: wird in den Viewport geschoben', () => {
    const p = computeMenuPosition({ top: 100, bottom: 130, left: 10, right: 40 }, { width: 230, height: 200 }, VIEWPORTS.phone, 'right', 'down');
    expect(p.left).toBe(8);
  });
});
