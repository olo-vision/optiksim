/**
 * Produktmarke (Logo + Name). Übernimmt Branding der Organisation (Name/Logo), falls gesetzt.
 */
import { useSession } from './session';
import { PRODUCT_NAME } from '@/platform/branding';

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="brand__mark" aria-hidden>
      <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      <circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <path d="M1.5 12 H6.5 M17.5 12 H22.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.2" />
    </svg>
  );
}

export function useProductName() {
  return useSession((s) => s.org?.branding.productName?.trim()) || PRODUCT_NAME;
}

export function Brand({ compact }: { compact?: boolean }) {
  const name = useProductName();
  const logo = useSession((s) => s.org?.branding.logoDataUrl);
  return (
    <span className="brand">
      {logo ? <img src={logo} alt="" className="brand__logo" /> : <BrandMark />}
      {!compact && <span className="brand__name">{name}</span>}
    </span>
  );
}
