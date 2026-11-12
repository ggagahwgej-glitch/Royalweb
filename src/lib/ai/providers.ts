import 'server-only';
import { getSecret } from '@/lib/secrets';
import type { AiMessage, AiProvider, AiResponse, ProviderId } from './types';

/**
 * Provider-agnostic AI layer. Any OpenAI-compatible endpoint works
 * (OpenAI, Groq, OpenRouter, Together, LM Studio, a local gateway), as do
 * Anthropic, Google Gemini and Ollama. Nothing is hardcoded to one vendor.
 */

const DEFAULTS: Record<ProviderId, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  custom: { baseUrl: '', model: '' },
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'llama3.1' },
  local: { baseUrl: '', model: 'royalweb-template-engine' },
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  google: 'Google Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  custom: 'Custom OpenAI-compatible endpoint',
  ollama: 'Ollama (self-hosted)',
  local: 'Built-in template engine (no external AI)',
};

export const PROVIDER_CHOICES: { id: ProviderId; label: string; requiresKey: boolean; note: string }[] = [
  { id: 'openai', label: 'OpenAI', requiresKey: true, note: 'GPT-4o family, strong poster vision' },
  { id: 'anthropic', label: 'Anthropic Claude', requiresKey: true, note: 'Claude 3.5/4 family, strong long-form writing' },
  { id: 'google', label: 'Google Gemini', requiresKey: true, note: 'Gemini Flash/Pro, vision + long context' },
  { id: 'groq', label: 'Groq', requiresKey: true, note: 'Very fast Llama hosting' },
  { id: 'openrouter', label: 'OpenRouter', requiresKey: true, note: 'One key, many models' },
  { id: 'custom', label: 'Custom OpenAI-compatible', requiresKey: false, note: 'Point at your own base URL (vLLM, LiteLLM, gateway)' },
  { id: 'ollama', label: 'Ollama (local)', requiresKey: false, note: 'Self-hosted, no data leaves your server' },
  { id: 'local', label: 'Built-in template engine', requiresKey: false, note: 'Works offline; uses campaign data, no poster OCR' },
];

function baseFor(id: ProviderId): string {
  const override = getSecret('ai.baseUrl');
  return (override || DEFAULTS[id].baseUrl).replace(/\/+$/, '');
}

function modelFor(id: ProviderId, requested?: string): string {
  return requested?.trim() || DEFAULTS[id].model;
}

function apiKey(): string {
  const key = getSecret('ai.apiKey');
  if (!key) throw new Error('AI API key is not configured. Add it in Settings → AI, or use the built-in template engine.');
  return key;
}

// ------------------------------------------------------------ OpenAI-compatible

function openAiCompatible(id: ProviderId, label: string, supportsVision = true): AiProvider {
  return {
    id,
    label,
    requiresKey: id !== 'ollama' && id !== 'custom',
    supportsVision,
    defaultModel: DEFAULTS[id].model,
    async chat(messages, opts) {
      const base = baseFor(id);
      if (!base) throw new Error('No base URL configured for the custom AI provider.');
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      const key = getSecret('ai.apiKey');
      if (key) headers.authorization = `Bearer ${key}`;
      if (id === 'openrouter') headers['http-referer'] = process.env.PUBLIC_BASE_URL || 'https://royalweb.local';

      const body: Record<string, unknown> = {
        model: modelFor(id, opts?.model),
        messages: messages.map(toOpenAiMessage),
        temperature: opts?.temperature ?? 0.7,
        max_tokens: opts?.maxTokens ?? 2400,
      };
      if (opts?.json) body.response_format = { type: 'json_object' };

      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${label} API error (HTTP ${res.status}): ${text.slice(0, 400)}`);
      const data = JSON.parse(text) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        model: data.model ?? modelFor(id, opts?.model),
        provider: id,
        usage: { promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens },
      } satisfies AiResponse;
    },
  };
}

function toOpenAiMessage(m: AiMessage) {
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: m.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text ?? '' }
        : { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.dataBase64}` } }
    ),
  };
}

// ------------------------------------------------------------------- Anthropic

const anthropic: AiProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  requiresKey: true,
  supportsVision: true,
  defaultModel: DEFAULTS.anthropic.model,
  async chat(messages, opts) {
    const system = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    const body = {
      model: modelFor('anthropic', opts?.model),
      max_tokens: opts?.maxTokens ?? 2400,
      temperature: opts?.temperature ?? 0.7,
      system: system || undefined,
      messages: rest.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content:
          typeof m.content === 'string'
            ? m.content
            : m.content.map((part) =>
                part.type === 'text'
                  ? { type: 'text', text: part.text ?? '' }
                  : {
                      type: 'image',
                      source: { type: 'base64', media_type: part.mimeType, data: part.dataBase64 },
                    }
              ),
      })),
    };
    const res = await fetch(`${baseFor('anthropic')}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Anthropic API error (HTTP ${res.status}): ${text.slice(0, 400)}`);
    const data = JSON.parse(text) as {
      content?: { type: string; text?: string }[];
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      text: (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n'),
      model: data.model ?? modelFor('anthropic', opts?.model),
      provider: 'anthropic',
      usage: { promptTokens: data.usage?.input_tokens, completionTokens: data.usage?.output_tokens },
    };
  },
};

// ---------------------------------------------------------------------- Gemini

const google: AiProvider = {
  id: 'google',
  label: 'Google Gemini',
  requiresKey: true,
  supportsVision: true,
  defaultModel: DEFAULTS.google.model,
  async chat(messages, opts) {
    const model = modelFor('google', opts?.model);
    const system = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts:
          typeof m.content === 'string'
            ? [{ text: m.content }]
            : m.content.map((p) =>
                p.type === 'text'
                  ? { text: p.text ?? '' }
                  : { inline_data: { mime_type: p.mimeType, data: p.dataBase64 } }
              ),
      }));
    const res = await fetch(
      `${baseFor('google')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey())}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents,
          generationConfig: {
            temperature: opts?.temperature ?? 0.7,
            maxOutputTokens: opts?.maxTokens ?? 2400,
            responseMimeType: opts?.json ? 'application/json' : 'text/plain',
          },
        }),
      }
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`Gemini API error (HTTP ${res.status}): ${text.slice(0, 400)}`);
    const data = JSON.parse(text) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    return {
      text: (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
      model,
      provider: 'google',
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
      },
    };
  },
};

// -------------------------------------------------------------------- Ollama

const ollama: AiProvider = {
  id: 'ollama',
  label: 'Ollama',
  requiresKey: false,
  supportsVision: true,
  defaultModel: DEFAULTS.ollama.model,
  async chat(messages, opts) {
    const base = baseFor('ollama');
    const body = {
      model: modelFor('ollama', opts?.model),
      stream: false,
      options: { temperature: opts?.temperature ?? 0.7, num_predict: opts?.maxTokens ?? 2400 },
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n'),
        images: typeof m.content === 'string' ? undefined : m.content.filter((p) => p.type === 'image').map((p) => p.dataBase64),
      })),
    };
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Ollama error (HTTP ${res.status}): ${text.slice(0, 300)}`);
    const data = JSON.parse(text) as { message?: { content?: string }; model?: string };
    return {
      text: data.message?.content ?? '',
      model: data.model ?? modelFor('ollama', opts?.model),
      provider: 'ollama',
      usage: {},
    };
  },
};

export const PROVIDERS: Record<Exclude<ProviderId, 'local'>, AiProvider> = {
  openai: openAiCompatible('openai', 'OpenAI'),
  anthropic,
  google,
  groq: openAiCompatible('groq', 'Groq', false),
  openrouter: openAiCompatible('openrouter', 'OpenRouter'),
  custom: openAiCompatible('custom', 'Custom endpoint', true),
  ollama,
};

/** Resolve the configured provider, or null when the local engine should be used. */
export function resolveProvider(provider: string, model?: string): AiProvider | null {
  const chosen = (provider || 'auto').trim().toLowerCase();
  if (chosen === 'local') return null;
  if (chosen === 'auto') {
    if (!getSecret('ai.apiKey')) return null;
    return withModel(PROVIDERS.openai, model);
  }
  if (chosen !== 'custom' && chosen !== 'ollama' && !getSecret('ai.apiKey')) return null;
  const impl = PROVIDERS[chosen as Exclude<ProviderId, 'local'>];
  return impl ? withModel(impl, model) : null;
}

function withModel(provider: AiProvider, model?: string): AiProvider {
  return model ? { ...provider, defaultModel: model } : provider;
}

export function providerModel(id: ProviderId, requested?: string) {
  return modelFor(id, requested);
}
