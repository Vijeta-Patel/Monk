import type { MonkConfig } from './config.ts';
import { listProxyModels } from './llm.ts';
// USD per million tokens. Provider cost doesn't reach TrueForge's cost field, so Monk prices tokens
// itself, from the LLM proxy's /model/info when it has prices.
export type Price = { input: number; output: number };

const FALLBACK: Record<string, Price> = {};

const prices = new Map<string, Price>(Object.entries(FALLBACK));

export function priceOf(model: string): Price {
  // Unknown price counts as zero rather than a made-up number; `monk models` shows what's known.
  return prices.get(model) ?? { input: 0, output: 0 };
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export async function refreshPricing(cfg: MonkConfig, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const models = await listProxyModels(cfg, fetchFn);
    let any = false;
    for (const m of models) {
      if (m.inputPerM !== null && m.outputPerM !== null) {
        prices.set(m.id, { input: m.inputPerM, output: m.outputPerM });
        any = true;
      }
    }
    return any;
  } catch {
    return false;
  }
}

export function setPrice(model: string, price: Price): void {
  prices.set(model, price);
}
