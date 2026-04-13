import { SlackConfigurationError, SlackTransportError } from './errors.js';
import type {
  NormalizedSlackMessage,
  SlackFetchLike,
  SlackFetchResponse,
  SlackTransport,
  SlackTransportContext,
  SlackWebhookTransportOptions,
} from './types.js';

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

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

function createStatusFailureMessage(response: SlackFetchResponse, attempt: number): string {
  return `Slack webhook delivery failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ''} after ${String(attempt)} attempt(s). Upstream response body was omitted from the caller-visible error.`;
}

function createTransportFailureMessage(attempt: number): string {
  return `Slack webhook delivery failed after ${String(attempt)} attempt(s). Upstream response details were omitted from the caller-visible error.`;
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
      for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
        try {
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
            if (attempt < DEFAULT_RETRY_ATTEMPTS && isTransientStatus(response.status)) {
              await waitForRetry(DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1), context.signal);
              continue;
            }

            throw new SlackTransportError(createStatusFailureMessage(response, attempt));
          }

          return {
            channel: message.channel,
            ok: true,
            response: body,
            statusCode: response.status,
            warnings: body && body !== 'ok' ? ['Slack webhook returned a non-standard success body.'] : [],
          };
        } catch (error) {
          if (isAbortError(error) || context.signal?.aborted) {
            throw error;
          }

          if (attempt < DEFAULT_RETRY_ATTEMPTS) {
            await waitForRetry(DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1), context.signal);
            continue;
          }

          if (error instanceof SlackTransportError) {
            throw error;
          }

          throw new SlackTransportError(createTransportFailureMessage(attempt));
        }
      }

      throw new SlackTransportError(createTransportFailureMessage(DEFAULT_RETRY_ATTEMPTS));
    },
  };
}
