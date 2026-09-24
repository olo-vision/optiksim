import { useEffect } from 'react';
import { applyDocumentTitle } from '@/platform/branding';
import { useSession } from './session';

/** Setzt den Fenstertitel „Seite · Produktname“. */
export function usePageTitle(page?: string) {
  const product = useSession((s) => s.org?.branding.productName);
  useEffect(() => {
    applyDocumentTitle(product, page);
  }, [product, page]);
}
