/**
 * Zentrale Bearbeitung von Linsen (Phase 5) – genutzt vom Inspector und vom Modul „Brillenglas“.
 *
 *  - Modus 'optical':  Wirkung (Rezept) bleibt bzw. wird gesetzt; die berechnete Fläche wird gelöst,
 *                      im Dickenmodus 'auto' iterativ mit der Mittendicke (designLensForRx).
 *  - Modus 'geometry': Radien/Parameter wie eingegeben; nur die Mittendicke folgt ggf. automatisch.
 * In beiden Fällen bleibt der augenseitige Scheitel (HSA) ortsfest.
 */
import type { LensElement, LensParams, MediumRef } from '@/model/types';
import type { Rx } from '@/core/math/powerMatrix';
import { replaceLensKeepingBackVertex } from '@/model/sceneFactory';
import { designLensForRx, lensOptics } from './lensOptics';
import { withAutoThickness } from './lensThickness';

export interface LensChange {
  rx?: Rx;
  medium?: MediumRef;
  patch?: Partial<LensParams>;
}

export interface LensEditResult {
  ok: boolean;
  el: LensElement;
  notes: string[];
}

export function editLens(el: LensElement, change: LensChange, mode: 'optical' | 'geometry' = 'optical'): LensEditResult {
  const tmp: LensElement = { ...el, medium: change.medium ?? el.medium, lens: { ...el.lens, ...(change.patch ?? {}) } };
  if (mode === 'optical') {
    const rx = change.rx ?? lensOptics(el).rx;
    const r = designLensForRx(tmp, rx);
    if (!r.ok) return { ok: false, el, notes: r.notes };
    return { ok: true, el: replaceLensKeepingBackVertex({ ...tmp, lens: el.lens }, r.lens), notes: r.notes };
  }
  return { ok: true, el: replaceLensKeepingBackVertex({ ...tmp, lens: el.lens }, withAutoThickness(tmp)), notes: [] };
}
