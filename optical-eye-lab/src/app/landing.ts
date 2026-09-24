/** Zielseite nach der Anmeldung (Einstellung „Startansicht“). */
import { useSession } from './session';
import { useAppStore } from '@/state/store';

export function landingPath(): string {
  const { user, sims } = useSession.getState();
  if (!user) return '/login';
  const view = useAppStore.getState().prefs.startView;
  if (view === 'library') return '/simulations';
  if (view === 'last-simulation') {
    const last = [...sims]
      .filter((m) => m.lastOpenedAt && !m.archived)
      .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))[0];
    if (last) return `/simulations/${last.id}`;
  }
  return '/dashboard';
}
