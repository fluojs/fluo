import type { AsyncModuleOptions, MaybePromise } from '@konekti/core';
import type { NotificationDispatchRequest } from '@konekti/notifications';
import type { QueueBackoffOptions, QueueRateLimiterOptions } from '@konekti/queue';

/** RFC 5322-style email address with an optional display name. */
export interface EmailAddress {
  address: string;
  name?: string;
}

/** Address input accepted by the public API before normalization. */
export type EmailAddressLike = string | EmailAddress;

/** One file attachment forwarded to the configured transport implementation. */
export interface EmailAttachment {
  content: string | Uint8Array;
  contentType?: string;
  filename: string;
}

/** Caller-supplied email message shape used for standalone delivery. */
export interface EmailMessage {
  attachments?: readonly EmailAttachment[];
  bcc?: EmailAddressLike | readonly EmailAddressLike[];
  cc?: EmailAddressLike | readonly EmailAddressLike[];
  from?: EmailAddressLike;
  headers?: Readonly<Record<string, string>>;
  html?: string;
  metadata?: Record<string, unknown>;
  replyTo?: EmailAddressLike | readonly EmailAddressLike[];
  subject?: string;
  text?: string;
  to: EmailAddressLike | readonly EmailAddressLike[];
}

/** Normalized address list used internally after option/default resolution. */
export type NormalizedEmailAddressList = readonly EmailAddress[];

/** Normalized email message passed to one transport implementation. */
export interface NormalizedEmailMessage {
  attachments?: readonly EmailAttachment[];
  bcc: NormalizedEmailAddressList;
  cc: NormalizedEmailAddressList;
  from: EmailAddress;
  headers?: Readonly<Record<string, string>>;
  html?: string;
  metadata?: Record<string, unknown>;
  replyTo: NormalizedEmailAddressList;
  subject?: string;
  text?: string;
  to: NormalizedEmailAddressList;
}

/** Context object forwarded to transport implementations per delivery attempt. */
export interface EmailTransportContext {
  signal?: AbortSignal;
}

/** Provider-specific receipt returned by one email transport. */
export interface EmailTransportReceipt {
  accepted?: readonly string[];
  messageId?: string;
  metadata?: Record<string, unknown>;
  pending?: readonly string[];
  rejected?: readonly string[];
  response?: string;
}

/** Transport contract implemented by runtime-specific or provider-specific email adapters. */
export interface EmailTransport {
  /**
   * Sends one normalized email message.
   *
   * @param message Normalized message with resolved addresses and defaults.
   * @param context Optional abort context propagated from the caller.
   * @returns Provider-specific receipt details normalized for the Konekti email contract.
   */
  send(message: NormalizedEmailMessage, context: EmailTransportContext): Promise<EmailTransportReceipt>;

  /**
   * Verifies transport readiness during bootstrap when configured.
   *
   * @returns A promise that resolves when the transport is ready for delivery.
   */
  verify?(): MaybePromise<void>;

  /**
   * Closes underlying transport resources during application shutdown.
   *
   * @returns A promise that resolves when resource cleanup completes.
   */
  close?(): MaybePromise<void>;
}

/** Factory used to construct a transport lazily during module bootstrap. */
export interface EmailTransportFactory {
  /**
   * Creates the transport instance used by {@link EmailService}.
   *
   * @returns The transport implementation that will own email delivery.
   */
  create(): MaybePromise<EmailTransport>;

  /**
   * Stable diagnostic label describing the injected transport kind.
   *
   * @remarks
   * This value is surfaced through platform status snapshots so applications can
   * tell which adapter is currently wired without the core package hard-coding a
   * provider-specific implementation.
   */
  kind?: string;

  /**
   * Declares whether the factory-created transport owns resources that the core package should close.
   *
   * @remarks
   * Factories default to `true` because they typically allocate the transport instance.
   * Directly injected transport instances default to `false` because the caller owns them.
   */
  ownsResources?: boolean;
}

/** Template render input used for `NotificationDispatchRequest.template` integration. */
export interface EmailTemplateRenderInput<TPayload extends EmailNotificationPayload = EmailNotificationPayload> {
  locale?: string;
  metadata?: Record<string, unknown>;
  payload: TPayload;
  subject?: string;
  template: string;
}

/** Render result returned by an optional email template renderer. */
export interface EmailTemplateRenderResult {
  html?: string;
  subject?: string;
  text?: string;
}

/** Optional renderer used to turn notification templates into concrete email bodies. */
export interface EmailTemplateRenderer {
  /**
   * Renders one notification template into email subject/body content.
   *
   * @typeParam TPayload Payload shape carried by the notification request.
   * @param input Template render input including the template key and opaque payload.
   * @returns Rendered subject/body fragments that are merged with explicit payload overrides.
   */
  render<TPayload extends EmailNotificationPayload = EmailNotificationPayload>(
    input: EmailTemplateRenderInput<TPayload>,
  ): MaybePromise<EmailTemplateRenderResult>;
}

/** Notification payload understood by {@link EmailChannel} and {@link EmailService.sendNotification}. */
export interface EmailNotificationPayload extends Record<string, unknown> {
  attachments?: readonly EmailAttachment[];
  bcc?: EmailAddressLike | readonly EmailAddressLike[];
  cc?: EmailAddressLike | readonly EmailAddressLike[];
  from?: EmailAddressLike;
  headers?: Readonly<Record<string, string>>;
  html?: string;
  metadata?: Record<string, unknown>;
  replyTo?: EmailAddressLike | readonly EmailAddressLike[];
  templateData?: Record<string, unknown>;
  text?: string;
  to?: EmailAddressLike | readonly EmailAddressLike[];
}

/** Shared notification request subtype consumed by the email channel implementation. */
export interface EmailNotificationDispatchRequest extends NotificationDispatchRequest<EmailNotificationPayload> {
  channel: string;
}

/** Caller-visible result returned by standalone and notification-backed email delivery. */
export interface EmailSendResult extends EmailTransportReceipt {
  accepted: readonly string[];
  messageId: string;
  pending: readonly string[];
  rejected: readonly string[];
}

/** Failure entry returned by tolerant batch delivery. */
export interface EmailSendFailure {
  error: Error;
  message: EmailMessage;
}

/** Summary returned by {@link EmailService.sendMany}. */
export interface EmailSendBatchResult {
  failed: number;
  failures: readonly EmailSendFailure[];
  results: readonly EmailSendResult[];
  succeeded: number;
}

/** Additional send controls applied to one email delivery attempt. */
export interface EmailSendOptions {
  signal?: AbortSignal;
}

/** Additional controls applied to one batch send operation. */
export interface EmailSendManyOptions extends EmailSendOptions {
  continueOnError?: boolean;
}

/** Queue worker execution defaults used by the built-in notifications queue integration. */
export interface EmailQueueWorkerOptions {
  attempts?: number;
  backoff?: QueueBackoffOptions;
  concurrency?: number;
  jobName?: string;
  rateLimiter?: QueueRateLimiterOptions;
}

/** Module options accepted by {@link EmailModule.forRoot} and `forRootAsync`. */
export interface EmailModuleOptions {
  defaultFrom?: EmailAddressLike;
  defaultReplyTo?: EmailAddressLike | readonly EmailAddressLike[];
  notifications?: {
    channel?: string;
  };
  renderer?: EmailTemplateRenderer;
  transport: EmailTransport | EmailTransportFactory;
  verifyOnModuleInit?: boolean;
}

/** Async registration options for email modules that derive config through DI. */
export type EmailAsyncModuleOptions = AsyncModuleOptions<EmailModuleOptions>;

/** Normalized module options resolved once during module registration. */
export interface NormalizedEmailModuleOptions {
  defaultFrom?: EmailAddress;
  defaultReplyTo: NormalizedEmailAddressList;
  notifications: {
    channel: string;
  };
  renderer?: EmailTemplateRenderer;
  transport: {
    create: () => Promise<EmailTransport>;
    kind: string;
    ownsResources: boolean;
  };
  verifyOnModuleInit: boolean;
}

/** Email facade exposed to application code and the compatibility token. */
export interface Email {
  /**
   * Sends one email message directly through the configured transport.
   *
   * @param message Caller-supplied email message with addresses, subject, and body content.
   * @param options Optional abort signal propagated to the transport.
   * @returns A normalized delivery receipt describing accepted/rejected recipients and the message id.
   */
  send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailSendResult>;

  /**
   * Sends multiple email messages in input order with optional tolerant failure handling.
   *
   * @param messages Ordered message list to deliver through the configured transport.
   * @param options Optional tolerant batch controls such as `continueOnError`.
   * @returns A batch summary containing successes and any captured failures.
   */
  sendMany(messages: readonly EmailMessage[], options?: EmailSendManyOptions): Promise<EmailSendBatchResult>;

  /**
   * Converts one notifications foundation request into a concrete email delivery.
   *
   * @param notification Shared notification envelope interpreted by the email package.
   * @param options Optional abort signal propagated to rendering and transport work.
   * @returns A normalized delivery receipt for the resulting email message.
   */
  sendNotification(
    notification: EmailNotificationDispatchRequest,
    options?: EmailSendOptions,
  ): Promise<EmailSendResult>;
}
