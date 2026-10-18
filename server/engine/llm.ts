import { getSetting } from './settings.js';
import { fetchJson } from '../lib/net.js';
import { log } from '../lib/logger.js';
import { usage } from '../services/usage.js';

/**
 * OPTIONAL paid/local LLM integration.
 *
 * ShortForge's built-in generator works with zero external services. If you
 * configure a provider here, hooks/scripts/translations are produced by the
 * model instead, with automatic fallback back to the local engine.
 *
 * Supported:
 *   - "ollama"  : local, free (http://localhost:11434)
 *   - "openai"  : any OpenAI-compatible endpoint (OpenAI, Groq, Together, ...)
 *                 -> may be paid; cost tracking is recorded per call
 */
export type LlmConfig = {
  provider: 'none' | 'ollama' | 'openai';
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
};

export function llmConfig(): LlmConfig {
  return {
    provider: getSetting<LlmConfig['provider']>('llm.provider', 'none'),
    baseUrl: getSetting<string>('llm.baseUrl', ''),
    model: getSetting<string>('llm.model', ''),
    apiKey: getSetting<string>('llm.apiKey', ''),
    temperature: getSetting<number>('llm.temperature', 0.8),
  };
}

export function llmAvailable(): boolean {
  const c = llmConfig();
  if (c.provider === 'none') return false;
  if (c.provider === 'ollama') return Boolean(c.model);
  return Boolean(c.baseUrl && c.model);
}

export class LlmUnavailableError extends Error {
  constructor(msg = 'No LLM provider configured') {
    super(msg);
    this.name = 'LlmUnavailableError';
  }
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

async function chat(cfg: LlmConfig, messages: ChatMessage[], jsonMode: boolean): Promise<string> {
  const isOpenAiStyle = cfg.provider === 'openai';
  const base = cfg.baseUrl || (cfg.provider === 'ollama' ? 'http://localhost:11434' : '');
  if (!base) throw new LlmUnavailableError('LLM base URL is not configured');

  const url = isOpenAiStyle ? `${base.replace(/\/$/, '')}/chat/completions` : `${base.replace(/\/$/, '')}/api/chat`;
  const body = isOpenAiStyle
    ? {
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }
    : {
        model: cfg.model,
        messages,
        stream: false,
        format: jsonMode ? 'json' : undefined,
        options: { temperature: cfg.temperature },
      };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const started = Date.now();
  const res = await fetchJson<any>(url, { method: 'POST', body: JSON.stringify(body), headers, timeoutMs: 90000 });

  let content = '';
  if (isOpenAiStyle) {
    content = res?.choices?.[0]?.message?.content ?? '';
  } else {
    content = res?.message?.content ?? '';
  }
  usage.record('llm_call', {
    provider: cfg.provider === 'ollama' ? 'ollama (free/local)' : cfg.provider,
    units: 1,
    unitLabel: 'call',
    // Ollama is free; hosted endpoints are charged by the provider, so the
    // default rate is 0 and the operator can set cost.paid.llm_per_1k_tokens.
    costUsd: cfg.provider === 'ollama' ? 0 : Math.round(((Date.now() - started) / 1000) * 0.0001 * 1000) / 1000,
    meta: { model: cfg.model },
  });
  if (!content) throw new Error('LLM returned an empty response');
  return content;
}

/** Free-form completion. Throws LlmUnavailableError when not configured. */
export async function llmComplete(system: string, user: string): Promise<string> {
  const cfg = llmConfig();
  if (cfg.provider === 'none') throw new LlmUnavailableError();
  return chat(cfg, [{ role: 'system', content: system }, { role: 'user', content: user }], false);
}

/** JSON completion with one retry on malformed output. */
export async function llmJson<T>(system: string, user: string): Promise<T> {
  const cfg = llmConfig();
  if (cfg.provider === 'none') throw new LlmUnavailableError();
  const raw = await chat(cfg, [{ role: 'system', content: system }, { role: 'user', content: user }], true);
  try {
    return parseJsonLoose<T>(raw);
  } catch (err) {
    log.warn('LLM JSON parse failed, retrying once');
    const retry = await chat(
      cfg,
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
        { role: 'assistant', content: raw },
        { role: 'user', content: 'Return only valid JSON matching the requested schema, no prose.' },
      ],
      true,
    );
    return parseJsonLoose<T>(retry);
  }
}

export function parseJsonLoose<T>(raw: string): T {
  const start = Math.min(...['{', '['].map((c) => (raw.indexOf(c) === -1 ? Infinity : raw.indexOf(c))));
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (!Number.isFinite(start) || end <= start) throw new Error('No JSON found in LLM output');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

/** Natural translation via the configured LLM (optional, free with Ollama). */
export async function translate(text: string, targetLang: string, context: string): Promise<string | null> {
  if (!llmAvailable()) return null;
  if (targetLang === 'en' && !context) return text;
  try {
    const out = await llmComplete(
      `You translate short-form video scripts. Translate naturally and idiomatically, not literally. Keep numbers, proper nouns and factual claims identical. Keep it the same approximate length. Output only the translation.`,
      `Target language code: ${targetLang}\nContext: ${context}\n\nText:\n${text}`,
    );
    return out.trim();
  } catch (err) {
    log.debug('translation failed', String(err));
    return null;
  }
}
