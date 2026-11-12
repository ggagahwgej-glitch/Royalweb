import { handler, jsonOk } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { resolveProvider } from '@/lib/ai/providers';
import { newId, nowIso, run } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Live provider check — really calls the configured model. */
export const POST = handler(async (_req, _ctx, auth) => {
  const settings = getSettings(auth.user.id);
  const provider = resolveProvider(settings.aiProvider, settings.aiModel);
  if (!provider) {
    return jsonOk({
      ok: false,
      mode: 'template',
      message:
        'No AI provider is configured, so the built-in template engine will be used. Add an API key in Settings → AI to enable AI generation.',
    });
  }
  const started = Date.now();
  try {
    const res = await provider.chat(
      [
        { role: 'system', content: 'You are a connectivity test. Reply with exactly: ROYALWEB AI OK' },
        { role: 'user', content: 'Reply with exactly: ROYALWEB AI OK' },
      ],
      { maxTokens: 20, temperature: 0 }
    );
    run(
      'INSERT INTO ai_activity_logs (id, user_id, kind, provider, model, ok, prompt_tokens, completion_tokens, meta_json, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
      newId(),
      auth.user.id,
      'provider_test',
      res.provider,
      res.model,
      res.usage.promptTokens ?? null,
      res.usage.completionTokens ?? null,
      JSON.stringify({ latencyMs: Date.now() - started }),
      nowIso()
    );
    return jsonOk({
      ok: true,
      provider: res.provider,
      model: res.model,
      latencyMs: Date.now() - started,
      reply: res.text.slice(0, 200),
      vision: provider.supportsVision,
    });
  } catch (err) {
    return jsonOk({
      ok: false,
      provider: provider.id,
      model: provider.defaultModel,
      message: (err as Error).message.slice(0, 600),
      latencyMs: Date.now() - started,
    });
  }
});
