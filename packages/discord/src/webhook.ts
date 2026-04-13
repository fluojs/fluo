import { DiscordConfigurationError, DiscordTransportError } from './errors.js';
import type {
  DiscordFetchLike,
  DiscordFetchResponse,
  DiscordTransport,
  DiscordTransportContext,
  DiscordWebhookTransportOptions,
  NormalizedDiscordMessage,
} from './types.js';

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function getStringField(body: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = body?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function createWebhookPayload(message: NormalizedDiscordMessage): Record<string, unknown> {
  return {
    ...(message.allowedMentions ? { allowed_mentions: message.allowedMentions } : {}),
    ...(message.attachments.length > 0 ? { attachments: message.attachments } : {}),
    ...(message.avatarUrl ? { avatar_url: message.avatarUrl } : {}),
    ...(message.components.length > 0 ? { components: message.components } : {}),
    ...(message.content ? { content: message.content } : {}),
    ...(message.embeds.length > 0 ? { embeds: message.embeds } : {}),
    ...(typeof message.flags === 'number' ? { flags: message.flags } : {}),
    ...(message.poll ? { poll: message.poll } : {}),
    ...(message.threadName ? { thread_name: message.threadName } : {}),
    ...(typeof message.tts === 'boolean' ? { tts: message.tts } : {}),
    ...(message.username ? { username: message.username } : {}),
  };
}

function resolveFetch(fetchLike: DiscordFetchLike | undefined): DiscordFetchLike {
  if (fetchLike) {
    return fetchLike;
  }

  if (typeof globalThis.fetch !== 'function') {
    throw new DiscordConfigurationError(
      'Discord webhook transport requires an explicit fetch implementation when `globalThis.fetch` is unavailable.',
    );
  }

  return (input, init) => globalThis.fetch(input, init as never) as Promise<DiscordFetchResponse>;
}

function parseWebhookUrl(webhookUrl: string): URL {
  try {
    return new URL(webhookUrl);
  } catch {
    throw new DiscordConfigurationError('Discord webhook transport requires a valid absolute `webhookUrl`.');
  }
}

function resolveWebhookUrl(
  webhookUrl: URL,
  message: NormalizedDiscordMessage,
  wait: boolean,
): string {
  const url = new URL(webhookUrl.toString());
  url.searchParams.set('wait', String(wait));

  if (message.threadId) {
    url.searchParams.set('thread_id', message.threadId);
  }

  return url.toString();
}

async function readResponseBody(response: DiscordFetchResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function createStatusFailureMessage(response: DiscordFetchResponse, attempt: number): string {
  return `Discord webhook delivery failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ''} after ${String(attempt)} attempt(s). Upstream response body was omitted from the caller-visible error.`;
}

function createTransportFailureMessage(attempt: number): string {
  return `Discord webhook delivery failed after ${String(attempt)} attempt(s). Upstream response details were omitted from the caller-visible error.`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

async function waitForRetry(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function parseJsonRecord(body: string): Record<string, unknown> | undefined {
  if (!body) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Creates a webhook-first Discord transport backed by an explicit fetch-compatible boundary.
 *
 * @param options Webhook URL plus an optional injected fetch implementation for portable runtimes.
 * @returns A Discord transport that posts JSON payloads to one Discord webhook endpoint.
 * @throws {DiscordConfigurationError} When the webhook url is empty or no fetch implementation is available.
 * @throws {DiscordTransportError} When Discord responds with a non-success HTTP status.
 *
 * @example
 * ```ts
 * const transport = createDiscordWebhookTransport({
 *   fetch: runtime.fetch,
 *   webhookUrl: 'https://discord.com/api/webhooks/123/abc',
 * });
 * ```
 */
export function createDiscordWebhookTransport(options: DiscordWebhookTransportOptions): DiscordTransport {
  const webhookUrl = normalizeOptionalString(options.webhookUrl);

  if (!webhookUrl) {
    throw new DiscordConfigurationError('Discord webhook transport requires a non-empty `webhookUrl`.');
  }

  const parsedWebhookUrl = parseWebhookUrl(webhookUrl);
  const fetchLike = resolveFetch(options.fetch);
  const wait = options.wait ?? true;

  return {
    async send(message: NormalizedDiscordMessage, context: DiscordTransportContext) {
      for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetchLike(resolveWebhookUrl(parsedWebhookUrl, message, wait), {
            body: JSON.stringify(createWebhookPayload(message)),
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
            method: 'POST',
            signal: context.signal,
          });

          const body = await readResponseBody(response);

          if (!response.ok) {
            if (attempt < DEFAULT_RETRY_ATTEMPTS && isTransientStatus(response.status)) {
              await waitForRetry(DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1), context.signal);
              continue;
            }

            throw new DiscordTransportError(createStatusFailureMessage(response, attempt));
          }

          const parsed = parseJsonRecord(body);
          const warnings: string[] = [];

          if (body && !parsed) {
            warnings.push('Discord webhook returned a non-JSON success body.');
          }

          return {
            channelId: getStringField(parsed, 'channel_id'),
            guildId: getStringField(parsed, 'guild_id'),
            messageId: getStringField(parsed, 'id'),
            ok: true,
            response: body || undefined,
            statusCode: response.status,
            threadId: getStringField(parsed, 'thread_id') ?? message.threadId,
            warnings,
          };
        } catch (error) {
          if (isAbortError(error) || context.signal?.aborted) {
            throw error;
          }

          if (attempt < DEFAULT_RETRY_ATTEMPTS) {
            await waitForRetry(DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1), context.signal);
            continue;
          }

          if (error instanceof DiscordTransportError) {
            throw error;
          }

          throw new DiscordTransportError(createTransportFailureMessage(attempt));
        }
      }

      throw new DiscordTransportError(createTransportFailureMessage(DEFAULT_RETRY_ATTEMPTS));
    },
  };
}
