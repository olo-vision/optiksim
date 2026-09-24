/**
 * Schematische Querschnitt-Symbole für optische Elemente (SVG, fachlich korrekt gezeichnet).
 */
import type { ElementKind } from '@/model/types';

const paths: Record<ElementKind, string> = {
  'converging-lens': 'M12 3 Q17 12 12 21 Q7 12 12 3 Z',
  biconvex: 'M12 3 Q18 12 12 21 Q7.5 12 12 3 Z',
  'diverging-lens': 'M8 3 H16 Q12.5 12 16 21 H8 Q11.5 12 8 3 Z',
  biconcave: 'M8.5 3 H15.5 Q12 12 15.5 21 H8.5 Q12 12 8.5 3 Z',
  'plano-convex': 'M10 3 Q17 12 10 21 Z',
  'plano-concave': 'M8 3 H14 Q10.5 12 14 21 H8 Z',
  'custom-lens': 'M9 3 Q15 12 9 21 H13 Q18 12 13 3 Z',
  'spectacle-lens': 'M9 3.5 Q15.5 12 9 20.5 L11.5 20.5 Q17 12 11.5 3.5 Z',
  'contact-lens': 'M8 6 Q14 12 8 18 L9.5 18 Q15 12 9.5 6 Z',
  'rigid-contact-lens': 'M9 7.5 Q13.5 12 9 16.5 L10.5 16.5 Q14.5 12 10.5 7.5 Z',
  'soft-contact-lens': 'M7.5 4.5 Q15 12 7.5 19.5 L8.8 19.5 Q16 12 8.8 4.5 Z',
  magnifier: 'M12 4 Q16.5 11 12 18 Q7.5 11 12 4 Z',
  prism: 'M12 3.5 L18 20.5 H6 Z',
  'plane-plate': 'M9.5 3 H14.5 V21 H9.5 Z',
  'custom-medium': 'M6 6 H18 V18 H6 Z',
};

export function ElementGlyph({ kind, size = 22 }: { kind: ElementKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="glyph" aria-hidden>
      <path d={paths[kind]} className="glyph__body" />
      {kind === 'magnifier' && <path d="M12 18 V22.5" className="glyph__line" />}
      {kind === 'custom-medium' && <path d="M6 10 H18 M6 14 H18" className="glyph__line glyph__line--faint" />}
    </svg>
  );
}

export function EyeGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="glyph" aria-hidden>
      <circle cx="13" cy="12" r="8" className="glyph__line" fill="none" />
      <path d="M6.2 8.5 Q3.5 12 6.2 15.5" className="glyph__line" fill="none" />
      <path d="M6.5 9 V15" className="glyph__iris" />
      <ellipse cx="8.8" cy="12" rx="1.3" ry="2.2" className="glyph__body" />
    </svg>
  );
}
