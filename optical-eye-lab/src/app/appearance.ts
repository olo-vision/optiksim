/**
 * Setzt Darstellungseinstellungen global auf <html>: Theme, Schriftgröße, Panel-Deckkraft,
 * Panelbreiten, reduzierte Bewegung sowie Produktname im Fenstertitel.
 */
import { useEffect, useState } from 'react';
import { useAppStore } from '@/state/store';
import type { ThemeMode } from '@/platform/preferences';

function systemPrefersLight() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
}

export function resolveTheme(mode: ThemeMode, sysLight: boolean): 'dark' | 'light' {
  return mode === 'system' ? (sysLight ? 'light' : 'dark') : mode;
}

export function useResolvedTheme(): 'dark' | 'light' {
  const mode = useAppStore((s) => s.prefs.theme);
  const [sysLight, setSysLight] = useState(systemPrefersLight);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const on = () => setSysLight(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return resolveTheme(mode, sysLight);
}

const FONT_SCALE = { small: 0.92, normal: 1, large: 1.1 } as const;

export function useApplyAppearance() {
  const theme = useResolvedTheme();
  const fontScale = useAppStore((s) => s.prefs.fontScale);
  const opacity = useAppStore((s) => s.prefs.panelOpacity);
  const leftW = useAppStore((s) => s.prefs.leftPanelWidth);
  const rightW = useAppStore((s) => s.prefs.rightPanelWidth);
  const reduced = useAppStore((s) => s.prefs.reducedMotion);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    el.style.colorScheme = theme;
    el.dataset.reducedMotion = reduced ? 'true' : 'false';
    el.style.setProperty('--font-scale', String(FONT_SCALE[fontScale]));
    el.style.setProperty('--panel-alpha', String(opacity));
    el.style.setProperty('--left-w-user', `${leftW}px`);
    el.style.setProperty('--right-w-user', `${rightW}px`);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  }, [theme, fontScale, opacity, leftW, rightW, reduced]);
}
