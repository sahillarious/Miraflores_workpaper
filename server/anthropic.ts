import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, type ModelProvider, type ModelRequest, type ModelResponse } from '../src/copilot/agent';

// The only file that talks to the model API. Runs on the server; the key never
// reaches the browser. Errors are mapped to a small set of kinds the UI shows.

export interface AnthropicConfig { apiKey: string; model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; timeoutMs: number }

export function anthropicProvider(cfg: AnthropicConfig): ModelProvider {
  const client = new Anthropic({ apiKey: cfg.apiKey, timeout: cfg.timeoutMs, maxRetries: 2 });
  return {
    name: 'anthropic',
    model: cfg.model,
    async create(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
      try {
        const msg = await client.beta.messages.create(
          {
            model: cfg.model,
            max_tokens: 16000,
            system: req.system,
            messages: req.messages,
            tools: req.tools,
            output_config: { effort: cfg.effort },
            // Server-side fallback: if the model declines for policy reasons the API retries on its default fallback.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            cache_control: { type: 'ephemeral' },
          },
          { signal },
        );
        return { content: msg.content as any[], stop_reason: msg.stop_reason, usage: msg.usage as any, model: msg.model };
      } catch (e) {
        if (e instanceof Anthropic.APIUserAbortError) throw new ProviderError('aborted', 'Request aborted.');
        if (e instanceof Anthropic.AuthenticationError) throw new ProviderError('auth', 'The API key was rejected (401).');
        if (e instanceof Anthropic.PermissionDeniedError) throw new ProviderError('auth', 'The API key lacks permission for this model (403).');
        if (e instanceof Anthropic.NotFoundError) throw new ProviderError('bad_request', `Model "${cfg.model}" not found or not available (404).`);
        if (e instanceof Anthropic.RateLimitError) throw new ProviderError('rate_limited', 'Rate limited by the provider (429) after retries. Try again shortly.');
        if (e instanceof Anthropic.BadRequestError) throw new ProviderError('bad_request', `Request rejected (400): ${e.message}`);
        if (e instanceof Anthropic.InternalServerError) throw new ProviderError('server', `Provider error (${e.status}) after retries.`);
        if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderError('timeout', 'Provider request timed out.');
        if (e instanceof Anthropic.APIConnectionError) throw new ProviderError('network', 'Could not reach the provider.');
        if (e instanceof Anthropic.APIError) throw new ProviderError('unknown', `Provider error: ${e.message}`);
        throw e;
      }
    },
  };
}
