import { DiscordConfigurationError, DiscordTransportError } from './errors.js';
import type {
  DiscordFetchLike,
  DiscordFetchResponse,
  DiscordTransport,
  DiscordTransportContext,
  DiscordWebhookTransportOptions,
  NormalizedDiscordMessage,
} from './types.js';

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

function resolveWebhookUrl(
  webhookUrl: string,
  message: NormalizedDiscordMessage,
  wait: boolean,
): string {
  const url = new URL(webhookUrl);
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

  const fetchLike = resolveFetch(options.fetch);
  const wait = options.wait ?? true;

  return {
    async send(message: NormalizedDiscordMessage, context: DiscordTransportContext) {
      const response = await fetchLike(resolveWebhookUrl(webhookUrl, message, wait), {
        body: JSON.stringify(createWebhookPayload(message)),
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        method: 'POST',
        signal: context.signal,
      });

      const body = await readResponseBody(response);

      if (!response.ok) {
        const suffix = body ? `: ${body}` : '';
        throw new DiscordTransportError(
          `Discord webhook delivery failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ''}${suffix}.`,
        );
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
    },
  };
}
