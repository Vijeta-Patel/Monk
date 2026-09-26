const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'use', 'when', 'is', 'it', 'a', 'from', 'by', 'be', 'as', 'at']);

function features(text: string): Map<string, number> {
  const words = text.toLowerCase().replace(/[^a-z0-9_ ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  const f = new Map<string, number>();
  const add = (k: string, w: number) => f.set(k, (f.get(k) ?? 0) + w);
  for (const w of words) {
    add(`w:${w}`, 1);
    const padded = ` ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) add(`t:${padded.slice(i, i + 3)}`, 0.5);
  }
  return f;
}

/** Cosine similarity over word + character-trigram counts. 0..1. */
export function textSimilarity(a: string, b: string): number {
  const fa = features(a);
  const fb = features(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of fa) {
    na += v * v;
    const w = fb.get(k);
    if (w) dot += v * w;
  }
  for (const v of fb.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}
