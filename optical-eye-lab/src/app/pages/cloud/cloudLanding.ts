/** Zielseite nach der Anmeldung im SaaS-Modus: nutzbare Lizenz → gewohnte Startansicht, sonst Lizenz-/Paketseite. */
import { canUseSimulator } from '@/cloud/access';
import { useCloud } from '../../cloudSession';
import { landingPath } from '../../landing';

export function cloudLandingPath(): string {
  const { user, access } = useCloud.getState();
  if (!user) return '/login';
  // aktiv, Demo läuft oder Zahlungsfrist → App (Phase 8: vorher landeten Nutzer in der Frist fälschlich auf /license)
  if (!canUseSimulator(access)) return '/license';
  return landingPath();
}
