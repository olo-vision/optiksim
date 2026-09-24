/**
 * Globale Tastenkürzel (inaktiv während Texteingabe).
 */
import { useEffect } from 'react';
import { useAppStore } from '@/state/store';
import { EYE_ID } from '@/model/types';

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useAppStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === 's') {
        e.preventDefault();
        if (e.shiftKey) s.shell?.saveAs();
        else void s.saveCurrent();
        return;
      }
      if (mod && key === 'o') {
        e.preventDefault();
        s.shell?.openLibrary();
        return;
      }
      if (isTyping(e) || s.dialog) return;

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        if (s.selectedId) s.duplicateEntity(s.selectedId);
        return;
      }
      if (mod || e.altKey) return;

      switch (e.key) {
        case 'q':
        case 'Q':
          s.setTool('select');
          break;
        case 'w':
        case 'W':
          s.setTool('translate');
          break;
        case 'e':
        case 'E':
          s.setTool('rotate');
          break;
        case 's':
        case 'S':
          s.toggleSnapping();
          break;
        case 'l':
        case 'L':
          s.setTransformSpace(s.transformSpace === 'world' ? 'local' : 'world');
          break;
        case 'a':
        case 'A':
          s.openDialog('add-element');
          break;
        case 'f':
        case 'F':
          s.sendCameraCommand({ type: 'focus-selection' });
          break;
        case 'g':
        case 'G':
          s.sendCameraCommand({ type: 'focus-eye' });
          break;
        case 'h':
        case 'H':
          s.sendCameraCommand({ type: 'focus-scene' });
          break;
        case 'Home':
          s.sendCameraCommand({ type: 'reset' });
          break;
        case '1':
          s.sendCameraCommand({ type: 'view', view: 'front' });
          break;
        case '3':
          s.sendCameraCommand({ type: 'view', view: 'side' });
          break;
        case '7':
          s.sendCameraCommand({ type: 'view', view: 'top' });
          break;
        case '5':
          s.setProjection(s.projection === 'perspective' ? 'orthographic' : 'perspective');
          break;
        case 'x':
        case 'X':
          s.updateEntity(EYE_ID, (en) => ({ ...en, viewMode: (en as typeof s.doc.eye).viewMode === 'section' ? 'normal' : 'section' }) as typeof en);
          break;
        case 'm':
        case 'M':
          s.setDocField('display', { showDimensions: !s.doc.display.showDimensions });
          break;
        case 't':
        case 'T':
          if (s.doc.lights.length) s.setDocField('display', { showRays: !s.doc.display.showRays });
          else s.notify('Für den Strahlengang zuerst eine Lichtquelle hinzufügen.', 'warning');
          break;
        case ' ':
          if (s.doc.display.showRays) {
            e.preventDefault();
            s.setSimulationLive(!s.simulationLive);
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (s.selectedId) {
            e.preventDefault();
            s.deleteEntity(s.selectedId);
          }
          break;
        case 'Escape':
          s.select(null);
          break;
        case '[':
          s.togglePanel('left');
          break;
        case ']':
          s.togglePanel('right');
          break;
        case '?':
          s.openDialog('shortcuts');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
