// The one LLM endpoint Monk calls directly (learning loop, cron parsing, model discovery).
// Any OpenAI-compatible server works; in practice it's a LiteLLM proxy. TrueForge itself reaches
// the same endpoint through its `custom` model provider.
import type { Llm } from './api.ts';
import type { MonkConfig } from './config.ts';

function endpoint(cfg: MonkConfig, path: string): string {
  if (!cfg.LLM_BASE_URL) throw new Error('LLM_BASE_URL is not set (your LiteLLM proxy, e.g. https://llm.example.com/v1)');
  return `${cfg.LLM_BASE_URL.replace(/\/+$/, '')}${path}`;
}

function headers(cfg: MonkConfig): Record<string, string> {
  return { 'content-type': 'application/json', ...(cfg.LLM_API_KEY ? { authorization: `Bearer ${cfg.LLM_API_KEY}` } : {}) };
}

function parseJsonContent(content: string): unknown {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  return JSON.parse(stripped);
}

/**
 * Chat completion that must return JSON matching `schema`. Tries strict json_schema first; models
 * behind a proxy that reject it get json_object with the schema spelled out in the prompt.
 */
export function proxyLlm(cfg: MonkConfig, opts: { model?: string; temperature?: number; fetch?: typeof fetch } = {}): Llm {
  const f = opts.fetch ?? fetch;
  const model = opts.model ?? cfg.MODEL;
  return async ({ system, user, schema }) => {
    const call = async (responseFormat: object, sys: string) => {
      const res = await f(endpoint(cfg, '/chat/completions'), {
        method: 'POST',
        headers: headers(cfg),
        body: JSON.stringify({
          model,
          temperature: opts.temperature ?? 0.2,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
          ],
          response_format: responseFormat,
        }),
      });
      return res;
    };
    let res = await call({ type: 'json_schema', json_schema: { name: 'monk_output', strict: true, schema } }, system);
    if (res.status === 400 || res.status === 422) {
      res = await call({ type: 'json_object' }, `${system}\n\nReply with only a JSON object matching this JSON schema:\n${JSON.stringify(schema)}`);
    }
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    return parseJsonContent(body.choices?.[0]?.message?.content ?? '');
  };
}

export type ProxyModel = {
  id: string;
  /** USD per million tokens, when the proxy knows. */
  inputPerM: number | null;
  outputPerM: number | null;
  toolCalling: boolean | null;
  vision: boolean | null;
  jsonSchema: boolean | null;
  maxInput: number | null;
};

type ModelInfoRow = {
  model_name?: string;
  model_info?: {
    input_cost_per_token?: number | null;
    output_cost_per_token?: number | null;
    supports_function_calling?: boolean | null;
    supports_vision?: boolean | null;
    supports_response_schema?: boolean | null;
    max_input_tokens?: number | null;
  };
};

/**
 * Models the proxy serves. LiteLLM's /model/info carries cost and capability flags; plain
 * OpenAI-compatible servers only have /models, so those fields come back null.
 */
export async function listProxyModels(cfg: MonkConfig, f: typeof fetch = fetch): Promise<ProxyModel[]> {
  const root = cfg.LLM_BASE_URL.replace(/\/+$/, '').replace(/\/v1$/, '');
  try {
    const res = await f(`${root}/model/info`, { headers: headers(cfg), signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const body = (await res.json()) as { data?: ModelInfoRow[] };
      const byId = new Map<string, ProxyModel>();
      for (const row of body.data ?? []) {
        if (!row.model_name) continue;
        const i = row.model_info ?? {};
        const perM = (v: number | null | undefined) => (typeof v === 'number' ? v * 1e6 : null);
        byId.set(row.model_name, {
          id: row.model_name,
          inputPerM: perM(i.input_cost_per_token),
          outputPerM: perM(i.output_cost_per_token),
          toolCalling: i.supports_function_calling ?? null,
          vision: i.supports_vision ?? null,
          jsonSchema: i.supports_response_schema ?? null,
          maxInput: i.max_input_tokens ?? null,
        });
      }
      if (byId.size) return [...byId.values()];
    }
  } catch {
    // Fall through to /models.
  }
  const res = await f(endpoint(cfg, '/models'), { headers: headers(cfg), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`LLM proxy /models ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => ({ id: m.id, inputPerM: null, outputPerM: null, toolCalling: null, vision: null, jsonSchema: null, maxInput: null }));
}

/** Blended cost for an agent workload, which reads far more than it writes (≈ 10:1). */
export function blendedCost(m: ProxyModel): number | null {
  if (m.inputPerM === null || m.outputPerM === null) return null;
  return (10 * m.inputPerM + m.outputPerM) / 11;
}

/** Tool-calling models, cheapest first; unknown capability or price sorts last. */
export function rankForAgent(models: ProxyModel[], opts: { needVision?: boolean } = {}): ProxyModel[] {
  return models
    .filter((m) => m.toolCalling !== false && (!opts.needVision || m.vision !== false))
    .filter((m) => !/embed|whisper|tts|dall-?e|image|rerank|moderation/i.test(m.id))
    .sort((a, b) => {
      const known = (m: ProxyModel) => (m.toolCalling === true ? 0 : 1);
      if (known(a) !== known(b)) return known(a) - known(b);
      const ca = blendedCost(a);
      const cb = blendedCost(b);
      if (ca === null && cb === null) return a.id.localeCompare(b.id);
      if (ca === null) return 1;
      if (cb === null) return -1;
      return ca - cb;
    });
}
