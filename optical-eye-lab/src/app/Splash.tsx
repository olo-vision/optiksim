/** Startbildschirm (beim Laden der lokalen Daten und beim Öffnen einer Simulation). */
import { BrandMark, useProductName } from './Brand';

export function Splash({ message = 'Lokale Daten werden geladen …' }: { message?: string }) {
  const name = useProductName();
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash__mark">
        <BrandMark size={56} />
      </div>
      <div className="splash__name">{name}</div>
      <div className="splash__sub">3D-Simulation für die Augenoptik</div>
      <div className="splash__bar">
        <span />
      </div>
      <div className="splash__msg">{message}</div>
    </div>
  );
}
