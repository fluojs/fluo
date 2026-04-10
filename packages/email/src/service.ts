import { Inject } from '@fluojs/core';
import type { OnApplicationShutdown, OnModuleInit } from '@fluojs/runtime';

import { DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS } from './constants.js';
import { EmailMessageValidationError } from './errors.js';
import { createEmailPlatformStatusSnapshot } from './status.js';
import { EMAIL_OPTIONS } from './tokens.js';
import type {
  Email,
  EmailAddress,
  EmailAddressLike,
  EmailMessage,
  EmailNotificationDispatchRequest,
    EmailSendBatchResult,
    EmailSendFailure,
    EmailSendManyOptions,
    EmailSendOptions,
    EmailSendResult,
    EmailTemplateRenderResult,
    EmailTransport,
    NormalizedEmailAddressList,
    NormalizedEmailMessage,
    NormalizedEmailModuleOptions,
  } from './types.js';

function normalizeAddress(address: EmailAddressLike): EmailAddress {
  if (typeof address === 'string') {
    const trimmed = address.trim();
    return { address: trimmed };
  }

  return {
    address: address.address.trim(),
    ...(address.name ? { name: address.name } : {}),
  };
}

function normalizeAddressList(value: EmailAddressLike | readonly EmailAddressLike[] | undefined): NormalizedEmailAddressList {
  if (!value) {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];
  return list.map((entry) => normalizeAddress(entry));
}

function createAbortError(): Error {
  const error = new Error('Email delivery was aborted.');
  error.name = 'AbortError';
  return error;
}

function assertMessageContent(message: NormalizedEmailMessage): void {
  if (message.to.length === 0) {
    throw new EmailMessageValidationError('Email messages require at least one recipient in `to`.');
  }

  if (!message.from.address) {
    throw new EmailMessageValidationError('Email messages require a resolved `from` address.');
  }

  if (!message.html && !message.text) {
    throw new EmailMessageValidationError('Email messages require `html` or `text` content.');
  }
}

/**
 * Injectable email delivery service for standalone and notifications-backed usage.
 *
 * @remarks
 * The service stays transport-agnostic at the shared package boundary, consumes only
 * explicitly injected {@link EmailTransport} contracts, and translates
 * `@fluojs/notifications` envelopes into concrete email messages.
 */
@Inject(EMAIL_OPTIONS)
export class EmailService implements Email, OnModuleInit, OnApplicationShutdown {
  private lifecycleState: 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  private resolvedTransport: EmailTransport | undefined;
  private transportPromise: Promise<EmailTransport> | undefined;

  constructor(private readonly options: NormalizedEmailModuleOptions) {}

  async onApplicationShutdown(): Promise<void> {
    this.lifecycleState = 'stopping';

    try {
      if (this.resolvedTransport && this.options.transport.ownsResources && this.resolvedTransport.close) {
        await this.resolvedTransport.close();
      }

      this.lifecycleState = 'stopped';
    } catch {
      this.lifecycleState = 'failed';
      throw new Error('Email transport failed to close cleanly.');
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
      throw new Error('Email transport failed to initialize.');
    }
  }

  /**
   * Creates a platform status snapshot for the active email transport wiring.
   *
   * @returns A structured snapshot describing lifecycle state, resource ownership, and notifications integration details.
   */
  createPlatformStatusSnapshot() {
    return createEmailPlatformStatusSnapshot({
      channelName: this.options.notifications.channel,
      defaultFromConfigured: this.options.defaultFrom !== undefined,
      lifecycleState: this.lifecycleState,
      ownsTransportResources: this.options.transport.ownsResources,
      queueWorkerJobName: DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS.jobName,
      transportKind: this.options.transport.kind,
      verifiedOnModuleInit: this.options.verifyOnModuleInit,
    });
  }

  /**
   * Sends one email message directly through the configured transport.
   *
   * @param message Caller-supplied email message with addresses, subject, and body content.
   * @param options Optional abort signal propagated to the transport.
   * @returns A normalized delivery receipt describing accepted/rejected recipients and the message id.
   * @throws {EmailMessageValidationError} When the resolved message is missing required sender, recipient, or content fields.
   *
   * @example
   * ```ts
   * await email.send({
   *   from: 'noreply@example.com',
   *   to: ['user@example.com'],
   *   subject: 'Welcome',
   *   text: 'Hello from Konekti',
   * });
   * ```
   */
  async send(message: EmailMessage, options: EmailSendOptions = {}): Promise<EmailSendResult> {
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    const transport = await this.ensureTransport();
    const normalized = this.normalizeMessage(message);
    assertMessageContent(normalized);
    const result = await transport.send(normalized, options);

    return {
      accepted: result.accepted ?? [],
      messageId: result.messageId ?? '',
      metadata: result.metadata,
      pending: result.pending ?? [],
      rejected: result.rejected ?? [],
      response: result.response,
    };
  }

  /**
   * Sends multiple email messages in input order with optional tolerant failure handling.
   *
   * @param messages Ordered message list to deliver through the configured transport.
   * @param options Optional tolerant batch controls such as `continueOnError`.
   * @returns A batch summary containing successes and any captured failures.
   *
   * @example
   * ```ts
   * const result = await email.sendMany(messages, { continueOnError: true });
   * console.log(result.succeeded, result.failed);
   * ```
   */
  async sendMany(messages: readonly EmailMessage[], options: EmailSendManyOptions = {}): Promise<EmailSendBatchResult> {
    const results: EmailSendResult[] = [];
    const failures: EmailSendFailure[] = [];

    for (const message of messages) {
      try {
        results.push(await this.send(message, options));
      } catch (error) {
        const failure = {
          error: error instanceof Error ? error : new Error('Email delivery failed.'),
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
   * Converts one notifications foundation request into a concrete email delivery.
   *
   * @param notification Shared notification envelope interpreted by the email package.
   * @param options Optional abort signal propagated to rendering and transport work.
   * @returns A normalized delivery receipt for the resulting email message.
   * @throws {EmailMessageValidationError} When the notification cannot resolve recipients or content.
   *
   * @example
   * ```ts
   * await email.sendNotification({
   *   channel: 'email',
   *   recipients: ['user@example.com'],
   *   subject: 'Digest',
   *   payload: { text: 'Your weekly update' },
   * });
   * ```
   */
  async sendNotification(
    notification: EmailNotificationDispatchRequest,
    options: EmailSendOptions = {},
  ): Promise<EmailSendResult> {
    const payload = notification.payload;
    const rendered = await this.renderNotification(notification);

    return this.send(
      {
        attachments: payload.attachments,
        bcc: payload.bcc,
        cc: payload.cc,
        from: payload.from,
        headers: payload.headers,
        html: payload.html ?? rendered?.html,
        metadata: {
          ...(payload.metadata ?? {}),
          ...(notification.metadata ?? {}),
          ...(notification.template ? { template: notification.template } : {}),
        },
        replyTo: payload.replyTo,
        subject: notification.subject ?? rendered?.subject,
        text: payload.text ?? rendered?.text,
        to: payload.to ?? notification.recipients ?? [],
      },
      options,
    );
  }

  private async ensureTransport(): Promise<EmailTransport> {
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

  private normalizeMessage(message: EmailMessage): NormalizedEmailMessage {
    const from = message.from ? normalizeAddress(message.from) : this.options.defaultFrom;
    const replyTo = normalizeAddressList(message.replyTo);

    if (!from) {
      throw new EmailMessageValidationError('Email messages require `from` or `defaultFrom` to be configured.');
    }

    return {
      attachments: message.attachments,
      bcc: normalizeAddressList(message.bcc),
      cc: normalizeAddressList(message.cc),
      from,
      headers: message.headers,
      html: message.html,
      metadata: message.metadata,
      replyTo: replyTo.length > 0 ? replyTo : this.options.defaultReplyTo,
      subject: message.subject,
      text: message.text,
      to: normalizeAddressList(message.to),
    };
  }

  private async renderNotification(
    notification: EmailNotificationDispatchRequest,
  ): Promise<EmailTemplateRenderResult | undefined> {
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
