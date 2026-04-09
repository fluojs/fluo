import { Inject } from '@konekti/core';
import type { OnApplicationShutdown, OnModuleInit } from '@konekti/runtime';

import { DiscordMessageValidationError } from './errors.js';
import { createDiscordPlatformStatusSnapshot } from './status.js';
import { DISCORD_OPTIONS } from './tokens.js';
import type {
  Discord,
  DiscordMessage,
  DiscordNotificationDispatchRequest,
  DiscordSendBatchResult,
  DiscordSendFailure,
  DiscordSendManyOptions,
  DiscordSendOptions,
  DiscordSendResult,
  DiscordTemplateRenderResult,
  DiscordTransport,
  NormalizedDiscordMessage,
  NormalizedDiscordModuleOptions,
} from './types.js';

function createAbortError(): Error {
  const error = new Error('Discord delivery was aborted.');
  error.name = 'AbortError';
  return error;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function assertMessageContent(message: NormalizedDiscordMessage): void {
  if (!message.content && message.embeds.length === 0 && message.components.length === 0 && message.attachments.length === 0) {
    throw new DiscordMessageValidationError(
      'Discord messages require `content`, `embeds`, `components`, or `attachments` content.',
    );
  }
}

/**
 * Injectable Discord delivery service for standalone and notifications-backed usage.
 *
 * @remarks
 * The service stays transport-agnostic at the shared package boundary, consumes only
 * explicitly injected {@link DiscordTransport} contracts, and translates
 * `@konekti/notifications` envelopes into concrete Discord messages.
 */
@Inject([DISCORD_OPTIONS])
export class DiscordService implements Discord, OnModuleInit, OnApplicationShutdown {
  private lifecycleState: 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  private resolvedTransport: DiscordTransport | undefined;
  private transportPromise: Promise<DiscordTransport> | undefined;

  constructor(private readonly options: NormalizedDiscordModuleOptions) {}

  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'stopping';

    try {
      if (this.resolvedTransport && this.options.transport.ownsResources && this.resolvedTransport.close) {
        await this.resolvedTransport.close();
      }

      this.lifecycleState = 'stopped';
    } catch {
      this.lifecycleState = 'failed';
      throw new Error('Discord transport failed to close cleanly.');
    }
  }

  async onModuleInit(): Promise<void> {
    this.lifecycleState = 'starting';

    try {
      const transport = await this.ensureTransport();

      if (this.options.verifyOnModuleInit && transport.verify) {
        await transport.verify();
      }

      this.lifecycleState = 'ready';
    } catch {
      this.lifecycleState = 'failed';
      throw new Error('Discord transport failed to initialize.');
    }
  }

  /**
   * Creates a platform status snapshot for the active Discord transport wiring.
   *
   * @returns A structured snapshot describing lifecycle state, resource ownership, and notifications integration details.
   */
  createPlatformStatusSnapshot() {
    return createDiscordPlatformStatusSnapshot({
      channelName: this.options.notifications.channel,
      defaultThreadConfigured: this.options.defaultThreadId !== undefined,
      lifecycleState: this.lifecycleState,
      ownsTransportResources: this.options.transport.ownsResources,
      transportKind: this.options.transport.kind,
      verifiedOnModuleInit: this.options.verifyOnModuleInit,
    });
  }

  /**
   * Sends one Discord message directly through the configured transport.
   *
   * @param message Caller-supplied Discord message with content, embeds, or component payloads.
   * @param options Optional abort signal propagated to the transport.
   * @returns A normalized delivery receipt describing the transport response.
   * @throws {DiscordMessageValidationError} When the resolved message does not include Discord-visible content.
   *
   * @example
   * ```ts
   * await discord.send({
   *   content: 'Deploy finished successfully.',
   * });
   * ```
   */
  async send(message: DiscordMessage, options: DiscordSendOptions = {}): Promise<DiscordSendResult> {
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    const transport = await this.ensureTransport();
    const normalized = this.normalizeMessage(message);
    assertMessageContent(normalized);
    const result = await transport.send(normalized, options);

    return {
      channelId: result.channelId,
      guildId: result.guildId,
      messageId: result.messageId,
      metadata: result.metadata,
      ok: result.ok ?? true,
      response: result.response,
      statusCode: result.statusCode,
      threadId: result.threadId ?? normalized.threadId,
      warnings: result.warnings ?? [],
    };
  }

  /**
   * Sends multiple Discord messages in input order with optional tolerant failure handling.
   *
   * @param messages Ordered message list to deliver through the configured transport.
   * @param options Optional tolerant batch controls such as `continueOnError`.
   * @returns A batch summary containing successes and any captured failures.
   *
   * @example
   * ```ts
   * const result = await discord.sendMany(messages, { continueOnError: true });
   * console.log(result.succeeded, result.failed);
   * ```
   */
  async sendMany(messages: readonly DiscordMessage[], options: DiscordSendManyOptions = {}): Promise<DiscordSendBatchResult> {
    const results: DiscordSendResult[] = [];
    const failures: DiscordSendFailure[] = [];

    for (const message of messages) {
      try {
        results.push(await this.send(message, options));
      } catch (error) {
        const failure = {
          error: error instanceof Error ? error : new Error('Discord delivery failed.'),
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
   * Converts one notifications foundation request into a concrete Discord delivery.
   *
   * @param notification Shared notification envelope interpreted by the Discord package.
   * @param options Optional abort signal propagated to rendering and transport work.
   * @returns A normalized delivery receipt for the resulting Discord message.
   * @throws {DiscordMessageValidationError} When the notification cannot resolve one target thread or any Discord-visible content.
   *
   * @example
   * ```ts
   * await discord.sendNotification({
   *   channel: 'discord',
   *   payload: { content: 'Deploy finished successfully.' },
   *   recipients: ['release-thread-id'],
   * });
   * ```
   */
  async sendNotification(
    notification: DiscordNotificationDispatchRequest,
    options: DiscordSendOptions = {},
  ): Promise<DiscordSendResult> {
    const payload = notification.payload;
    const rendered = await this.renderNotification(notification);

    return this.send(
      {
        allowedMentions: payload.allowedMentions,
        attachments: payload.attachments ?? [],
        avatarUrl: payload.avatarUrl,
        components: payload.components ?? rendered?.components,
        content: payload.content ?? rendered?.content ?? notification.subject,
        embeds: payload.embeds ?? rendered?.embeds,
        flags: payload.flags,
        metadata: {
          ...(payload.metadata ?? {}),
          ...(notification.metadata ?? {}),
          ...(notification.subject ? { subject: notification.subject } : {}),
          ...(notification.template ? { template: notification.template } : {}),
        },
        poll: payload.poll,
        threadId: this.resolveNotificationThreadId(notification),
        threadName: payload.threadName,
        tts: payload.tts,
        username: payload.username,
      },
      options,
    );
  }

  private async ensureTransport(): Promise<DiscordTransport> {
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

  private normalizeMessage(message: DiscordMessage): NormalizedDiscordMessage {
    return {
      allowedMentions: message.allowedMentions,
      attachments: message.attachments ?? [],
      avatarUrl: normalizeOptionalString(message.avatarUrl),
      components: message.components ?? [],
      content: normalizeOptionalString(message.content),
      embeds: message.embeds ?? [],
      flags: message.flags,
      metadata: message.metadata,
      poll: message.poll,
      threadId: normalizeOptionalString(message.threadId) ?? this.options.defaultThreadId,
      threadName: normalizeOptionalString(message.threadName),
      tts: message.tts,
      username: normalizeOptionalString(message.username),
    };
  }

  private resolveNotificationThreadId(notification: DiscordNotificationDispatchRequest): string | undefined {
    const payloadThreadId = normalizeOptionalString(notification.payload.threadId);

    if (payloadThreadId) {
      return payloadThreadId;
    }

    const recipients = notification.recipients?.map((entry) => entry.trim()).filter((entry) => entry.length > 0) ?? [];

    if (recipients.length > 1) {
      throw new DiscordMessageValidationError(
        'Discord notifications accept exactly one target thread per dispatch. Use `dispatchMany(...)` for fan-out delivery.',
      );
    }

    return recipients[0] ?? this.options.defaultThreadId;
  }

  private async renderNotification(
    notification: DiscordNotificationDispatchRequest,
  ): Promise<DiscordTemplateRenderResult | undefined> {
    if (!notification.template || !this.options.renderer) {
      return undefined;
    }

    return this.options.renderer.render({
      locale: notification.locale,
      metadata: notification.metadata,
      payload: notification.payload,
      subject: notification.subject,
      template: notification.template,
    });
  }
}
