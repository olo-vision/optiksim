let counter = 0;

/** Erzeugt eine kurze, kollisionsarme ID (lokal, ohne externe Abhängigkeit). */
export function createId(prefix = 'obj'): string {
  counter = (counter + 1) % 1_000_000;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rnd}`;
}
