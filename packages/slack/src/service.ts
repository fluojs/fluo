import { Inject } from '@fluojs/core';
import type { OnApplicationShutdown, OnModuleInit } from '@fluojs/runtime';

import { SlackLifecycleError, SlackMessageValidationError } from './errors.js';
import { createSlackPlatformStatusSnapshot } from './status.js';
import { SLACK_OPTIONS } from './tokens.js';
import type {
  NormalizedSlackMessage,
  NormalizedSlackModuleOptions,
  Slack,
  SlackMessage,
  SlackNotificationDispatchRequest,
  SlackSendBatchResult,
  SlackSendFailure,
  SlackSendManyOptions,
  SlackSendOptions,
  SlackSendResult,
  SlackTemplateRenderResult,
  SlackTransport,
} from './types.js';

function createAbortError(): Error {
  const error = new Error('Slack delivery was aborted.');
  error.name = 'AbortError';
  return error;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

type SlackServiceLifecycleState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

function createLifecycleError(message: string, cause: unknown): SlackLifecycleError {
  return new SlackLifecycleError(message, { cause });
}

function createDeliveryLifecycleError(state: SlackServiceLifecycleState): SlackLifecycleError {
  return new SlackLifecycleError(`Slack delivery cannot start while the service lifecycle is ${state}.`);
}

function isShutdownLifecycleState(
  state: SlackServiceLifecycleState,
): state is Extract<SlackServiceLifecycleState, 'stopping' | 'stopped'> {
  return state === 'stopping' || state === 'stopped';
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function assertMessageContent(message: NormalizedSlackMessage): void {
  if (!message.text && message.blocks.length === 0 && message.attachments.length === 0) {
    throw new SlackMessageValidationError(
      'Slack messages require `text`, `blocks`, or `attachments` content.',
    );
  }
}

/**
 * Injectable Slack delivery service for standalone and notifications-backed usage.
 *
 * @remarks
 * The service stays transport-agnostic at the shared package boundary, consumes only
 * explicitly injected {@link SlackTransport} contracts, and translates
 * `@fluojs/notifications` envelopes into concrete Slack messages.
 */
@Inject(SLACK_OPTIONS)
export class SlackService implements Slack, OnModuleInit, OnApplicationShutdown {
  private lifecycleState: SlackServiceLifecycleState = 'created';
  private resolvedTransport: SlackTransport | undefined;
  private transportPromise: Promise<SlackTransport> | undefined;

  constructor(private readonly options: NormalizedSlackModuleOptions) {}

  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'stopping';

    try {
      const transport = this.resolvedTransport ?? (this.transportPromise ? await this.transportPromise : undefined);

      if (transport && this.options.transport.ownsResources && transport.close) {
        await transport.close();
      }

      this.lifecycleState = 'stopped';
    } catch (error) {
      this.lifecycleState = 'failed';
      throw createLifecycleError('Slack transport failed to close cleanly.', error);
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped') {
      return;
    }

    this.lifecycleState = 'starting';

    try {
      const transport = await this.ensureTransport();

      if (this.lifecycleState !== 'starting') {
        return;
      }

      if (this.options.verifyOnModuleInit && transport.verify) {
        await transport.verify();
      }

      if (this.lifecycleState !== 'starting') {
        return;
      }

      this.lifecycleState = 'ready';
    } catch (error) {
      if (isShutdownLifecycleState(this.lifecycleState)) {
        throw error;
      }

      this.lifecycleState = 'failed';
      throw createLifecycleError('Slack transport failed to initialize.', error);
    }
  }

  /**
   * Creates a platform status snapshot for the active Slack transport wiring.
   *
   * @returns A structured snapshot describing lifecycle state, resource ownership, and notifications integration details.
   */
  createPlatformStatusSnapshot() {
    return createSlackPlatformStatusSnapshot({
      channelName: this.options.notifications.channel,
      defaultChannelConfigured: this.options.defaultChannel !== undefined,
      lifecycleState: this.lifecycleState,
      ownsTransportResources: this.options.transport.ownsResources,
      transportKind: this.options.transport.kind,
      verifiedOnModuleInit: this.options.verifyOnModuleInit,
    });
  }

  /**
   * Sends one Slack message directly through the configured transport.
   *
   * @param message Caller-supplied Slack message with text and/or block content.
   * @param options Optional abort signal propagated to the transport.
   * @returns A normalized delivery receipt describing the transport response.
   * @throws {SlackMessageValidationError} When the resolved message does not include Slack-visible content.
   *
   * @example
   * ```ts
   * await slack.send({
   *   channel: '#ops',
   *   text: 'Deploy finished successfully.',
   * });
   * ```
   */
  async send(message: SlackMessage, options: SlackSendOptions = {}): Promise<SlackSendResult> {
    assertNotAborted(options.signal);
    this.assertCanDeliver();

    const transport = await this.ensureTransport();
    const normalized = this.normalizeMessage(message);
    assertMessageContent(normalized);
    assertNotAborted(options.signal);
    this.assertCanDeliver();
    const result = await transport.send(normalized, options);

    return {
      channel: result.channel ?? normalized.channel,
      messageTs: result.messageTs,
      metadata: result.metadata,
      ok: result.ok ?? true,
      response: result.response,
      statusCode: result.statusCode,
      warnings: result.warnings ?? [],
    };
  }

  /**
   * Sends multiple Slack messages in input order with optional tolerant failure handling.
   *
   * @param messages Ordered message list to deliver through the configured transport.
   * @param options Optional tolerant batch controls such as `continueOnError`.
   * @returns A batch summary containing successes and any captured failures.
   *
   * @example
   * ```ts
   * const result = await slack.sendMany(messages, { continueOnError: true });
   * console.log(result.succeeded, result.failed);
   * ```
   */
  async sendMany(messages: readonly SlackMessage[], options: SlackSendManyOptions = {}): Promise<SlackSendBatchResult> {
    const results: SlackSendResult[] = [];
    const failures: SlackSendFailure[] = [];

    for (const message of messages) {
      try {
        results.push(await this.send(message, options));
      } catch (error) {
        const failure = {
          error: error instanceof Error ? error : new Error('Slack delivery failed.'),
          message,
        };

        if (!(options.continueOnError ?? false)) {
          throw failure.error;
        }

        failures.push(failure);
      }
    }

    return {
      failed: failures.length,
      failures,
      results,
      succeeded: results.length,
    };
  }

  /**
   * Converts one notifications foundation request into a concrete Slack delivery.
   *
   * @param notification Shared notification envelope interpreted by the Slack package.
   * @param options Optional abort signal propagated to rendering and transport work.
   * @returns A normalized delivery receipt for the resulting Slack message.
   * @throws {SlackMessageValidationError} When the notification cannot resolve one target channel or any Slack-visible content.
   *
   * @example
   * ```ts
   * await slack.sendNotification({
   *   channel: 'slack',
   *   payload: { text: 'Deploy finished successfully.' },
   *   recipients: ['#ops'],
   * });
   * ```
   */
  async sendNotification(
    notification: SlackNotificationDispatchRequest,
    options: SlackSendOptions = {},
  ): Promise<SlackSendResult> {
    assertNotAborted(options.signal);
    this.assertCanDeliver();

    const payload = notification.payload;
    const rendered = await this.renderNotification(notification, options.signal);

    assertNotAborted(options.signal);

    return this.send(
      {
        attachments: payload.attachments ?? rendered?.attachments,
        blocks: payload.blocks ?? rendered?.blocks,
        channel: this.resolveNotificationChannel(notification),
        iconEmoji: payload.iconEmoji,
        iconUrl: payload.iconUrl,
        metadata: {
          ...(payload.metadata ?? {}),
          ...(notification.metadata ?? {}),
          ...(notification.subject ? { subject: notification.subject } : {}),
          ...(notification.template ? { template: notification.template } : {}),
        },
        mrkdwn: payload.mrkdwn,
        replyBroadcast: payload.replyBroadcast,
        text: payload.text ?? rendered?.text ?? notification.subject,
        threadTs: payload.threadTs,
        unfurlLinks: payload.unfurlLinks,
        unfurlMedia: payload.unfurlMedia,
        username: payload.username,
      },
      options,
    );
  }

  private async ensureTransport(): Promise<SlackTransport> {
    this.assertCanCreateOrUseTransport();

    if (this.resolvedTransport) {
      return this.resolvedTransport;
    }

    if (!this.transportPromise) {
      this.transportPromise = this.options.transport.create().then((transport) => {
        this.resolvedTransport = transport;
        return transport;
      });
    }

    return this.transportPromise;
  }

  private assertCanCreateOrUseTransport(): void {
    if (this.lifecycleState === 'stopping' || this.lifecycleState === 'stopped' || this.lifecycleState === 'failed') {
      throw createDeliveryLifecycleError(this.lifecycleState);
    }
  }

  private assertCanDeliver(): void {
    this.assertCanCreateOrUseTransport();
  }

  private normalizeMessage(message: SlackMessage): NormalizedSlackMessage {
    return {
      attachments: message.attachments ?? [],
      blocks: message.blocks ?? [],
      channel: normalizeOptionalString(message.channel) ?? this.options.defaultChannel,
      iconEmoji: normalizeOptionalString(message.iconEmoji),
      iconUrl: normalizeOptionalString(message.iconUrl),
      metadata: message.metadata,
      mrkdwn: message.mrkdwn,
      replyBroadcast: message.replyBroadcast,
      text: normalizeOptionalString(message.text),
      threadTs: normalizeOptionalString(message.threadTs),
      unfurlLinks: message.unfurlLinks,
      unfurlMedia: message.unfurlMedia,
      username: normalizeOptionalString(message.username),
    };
  }

  private resolveNotificationChannel(notification: SlackNotificationDispatchRequest): string | undefined {
    const payloadChannel = normalizeOptionalString(notification.payload.channel);

    if (payloadChannel) {
      return payloadChannel;
    }

    const recipients = notification.recipients?.map((entry) => entry.trim()).filter((entry) => entry.length > 0) ?? [];

    if (recipients.length > 1) {
      throw new SlackMessageValidationError(
        'Slack notifications accept exactly one target channel per dispatch. Use `sendMany(...)` for fan-out delivery.',
      );
    }

    return recipients[0] ?? this.options.defaultChannel;
  }

  private async renderNotification(
    notification: SlackNotificationDispatchRequest,
    signal: AbortSignal | undefined,
  ): Promise<SlackTemplateRenderResult | undefined> {
    if (!notification.template || !this.options.renderer) {
      return undefined;
    }

    assertNotAborted(signal);

    return this.options.renderer.render({
      locale: notification.locale,
      metadata: notification.metadata,
      payload: notification.payload,
      subject: notification.subject,
      template: notification.template,
    });
  }
}
