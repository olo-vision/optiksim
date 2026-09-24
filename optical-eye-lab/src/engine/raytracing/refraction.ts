/**
 * Snelliussches Brechungsgesetz in Vektorform.
 *   n₁·sin ε₁ = n₂·sin ε₂
 *   t = η·d + (η·cos ε₁ − cos ε₂)·N     mit η = n₁/n₂,  N gegen den einfallenden Strahl gerichtet
 */
import { dot, madd, neg, normalize, scale, type Vec3 } from '@/core/math/vec';

export interface RefractionResult {
  dir: Vec3;
  totalInternalReflection: boolean;
}

/**
 * @param d  einfallende Richtung (normiert)
 * @param n  Flächennormale (beliebige Orientierung, wird gegen d ausgerichtet)
 */
export function refract(d: Vec3, n: Vec3, n1: number, n2: number): RefractionResult {
  let N = n;
  let cosi = -dot(N, d);
  if (cosi < 0) {
    N = neg(N);
    cosi = -cosi;
  }
  const eta = n1 / n2;
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) {
    return { dir: normalize(madd(d, N, 2 * cosi)), totalInternalReflection: true };
  }
  return { dir: normalize(madd(scale(d, eta), N, eta * cosi - Math.sqrt(k))), totalInternalReflection: false };
}
