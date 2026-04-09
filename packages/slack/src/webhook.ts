import { SlackConfigurationError, SlackTransportError } from './errors.js';
import type {
  NormalizedSlackMessage,
  SlackFetchLike,
  SlackFetchResponse,
  SlackTransport,
  SlackTransportContext,
  SlackWebhookTransportOptions,
} from './types.js';

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function createWebhookPayload(message: NormalizedSlackMessage): Record<string, unknown> {
  return {
    ...(message.attachments.length > 0 ? { attachments: message.attachments } : {}),
    ...(message.blocks.length > 0 ? { blocks: message.blocks } : {}),
    ...(message.channel ? { channel: message.channel } : {}),
    ...(message.iconEmoji ? { icon_emoji: message.iconEmoji } : {}),
    ...(message.iconUrl ? { icon_url: message.iconUrl } : {}),
    ...(typeof message.mrkdwn === 'boolean' ? { mrkdwn: message.mrkdwn } : {}),
    ...(typeof message.replyBroadcast === 'boolean' ? { reply_broadcast: message.replyBroadcast } : {}),
    ...(message.text ? { text: message.text } : {}),
    ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
    ...(typeof message.unfurlLinks === 'boolean' ? { unfurl_links: message.unfurlLinks } : {}),
    ...(typeof message.unfurlMedia === 'boolean' ? { unfurl_media: message.unfurlMedia } : {}),
    ...(message.username ? { username: message.username } : {}),
  };
}

function resolveFetch(fetchLike: SlackFetchLike | undefined): SlackFetchLike {
  if (fetchLike) {
    return fetchLike;
  }

  if (typeof globalThis.fetch !== 'function') {
    throw new SlackConfigurationError(
      'Slack webhook transport requires an explicit fetch implementation when `globalThis.fetch` is unavailable.',
    );
  }

  return (input, init) => globalThis.fetch(input, init as never) as Promise<SlackFetchResponse>;
}

async function readResponseBody(response: SlackFetchResponse): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Creates a webhook-first Slack transport backed by an explicit fetch-compatible boundary.
 *
 * @param options Webhook URL plus an optional injected fetch implementation for portable runtimes.
 * @returns A Slack transport that posts JSON payloads to one Slack incoming webhook endpoint.
 * @throws {SlackConfigurationError} When the webhook url is empty or no fetch implementation is available.
 * @throws {SlackTransportError} When Slack responds with a non-success HTTP status.
 *
 * @example
 * ```ts
 * const transport = createSlackWebhookTransport({
 *   fetch: runtime.fetch,
 *   webhookUrl: 'https://hooks.slack.com/services/XXX/YYY/ZZZ',
 * });
 * ```
 */
export function createSlackWebhookTransport(options: SlackWebhookTransportOptions): SlackTransport {
  const webhookUrl = normalizeOptionalString(options.webhookUrl);

  if (!webhookUrl) {
    throw new SlackConfigurationError('Slack webhook transport requires a non-empty `webhookUrl`.');
  }

  const fetchLike = resolveFetch(options.fetch);

  return {
    async send(message: NormalizedSlackMessage, context: SlackTransportContext) {
      const response = await fetchLike(webhookUrl, {
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
        throw new SlackTransportError(
          `Slack webhook delivery failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ''}${suffix}.`,
        );
      }

      return {
        channel: message.channel,
        ok: true,
        response: body,
        statusCode: response.status,
        warnings: body && body !== 'ok' ? ['Slack webhook returned a non-standard success body.'] : [],
      };
    },
  };
}
