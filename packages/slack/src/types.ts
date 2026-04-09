import type { AsyncModuleOptions, MaybePromise } from '@konekti/core';
import type { NotificationDispatchRequest } from '@konekti/notifications';

/** Opaque Slack Block Kit object forwarded to one transport implementation. */
export type SlackBlock = Readonly<Record<string, unknown>>;

/** Opaque Slack attachment object forwarded to one transport implementation. */
export type SlackAttachment = Readonly<Record<string, unknown>>;

/** Caller-supplied Slack message shape used for standalone delivery. */
export interface SlackMessage {
  attachments?: readonly SlackAttachment[];
  blocks?: readonly SlackBlock[];
  channel?: string;
  iconEmoji?: string;
  iconUrl?: string;
  metadata?: Record<string, unknown>;
  mrkdwn?: boolean;
  replyBroadcast?: boolean;
  text?: string;
  threadTs?: string;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
  username?: string;
}

/** Normalized Slack message passed to one transport implementation. */
export interface NormalizedSlackMessage {
  attachments: readonly SlackAttachment[];
  blocks: readonly SlackBlock[];
  channel?: string;
  iconEmoji?: string;
  iconUrl?: string;
  metadata?: Record<string, unknown>;
  mrkdwn?: boolean;
  replyBroadcast?: boolean;
  text?: string;
  threadTs?: string;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
  username?: string;
}

/** Context object forwarded to transport implementations per delivery attempt. */
export interface SlackTransportContext {
  signal?: AbortSignal;
}

/** Provider-specific receipt returned by one Slack transport. */
export interface SlackTransportReceipt {
  channel?: string;
  messageTs?: string;
  metadata?: Record<string, unknown>;
  ok?: boolean;
  response?: string;
  statusCode?: number;
  warnings?: readonly string[];
}

/** Transport contract implemented by runtime-specific or provider-specific Slack adapters. */
export interface SlackTransport {
  /**
   * Sends one normalized Slack message.
   *
   * @param message Normalized message with resolved defaults and one target channel.
   * @param context Optional abort context propagated from the caller.
   * @returns Provider-specific receipt details normalized for the Konekti Slack contract.
   */
  send(message: NormalizedSlackMessage, context: SlackTransportContext): Promise<SlackTransportReceipt>;

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
export interface SlackTransportFactory {
  /**
   * Creates the transport instance used by {@link SlackService}.
   *
   * @returns The transport implementation that will own Slack delivery.
   */
  create(): MaybePromise<SlackTransport>;

  /**
   * Stable diagnostic label describing the injected transport kind.
   *
   * @remarks
   * This value is surfaced through platform status snapshots so applications can
   * tell which adapter is currently wired without the package hard-coding a
   * provider-specific runtime dependency.
   */
  kind?: string;

  /**
   * Declares whether the factory-created transport owns resources that the package should close.
   *
   * @remarks
   * Factories default to `true` because they typically allocate the transport instance.
   * Directly injected transport instances default to `false` because the caller owns them.
   */
  ownsResources?: boolean;
}

/** Minimal fetch-compatible response contract used by the built-in webhook transport helper. */
export interface SlackFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  text(): MaybePromise<string>;
}

/** Minimal fetch-compatible function signature used by the built-in webhook transport helper. */
export interface SlackFetchLike {
  (input: string, init?: {
    body?: string;
    headers?: Readonly<Record<string, string>>;
    method?: string;
    signal?: AbortSignal;
  }): MaybePromise<SlackFetchResponse>;
}

/** Options accepted by {@link createSlackWebhookTransport}. */
export interface SlackWebhookTransportOptions {
  fetch?: SlackFetchLike;
  webhookUrl: string;
}

/** Template render input used for `NotificationDispatchRequest.template` integration. */
export interface SlackTemplateRenderInput<TPayload extends SlackNotificationPayload = SlackNotificationPayload> {
  locale?: string;
  metadata?: Record<string, unknown>;
  payload: TPayload;
  subject?: string;
  template: string;
}

/** Render result returned by an optional Slack template renderer. */
export interface SlackTemplateRenderResult {
  attachments?: readonly SlackAttachment[];
  blocks?: readonly SlackBlock[];
  text?: string;
}

/** Optional renderer used to turn notification templates into concrete Slack content. */
export interface SlackTemplateRenderer {
  /**
   * Renders one notification template into Slack text and/or Block Kit content.
   *
   * @typeParam TPayload Payload shape carried by the notification request.
   * @param input Template render input including the template key and opaque payload.
   * @returns Rendered text or block fragments that are merged with explicit payload overrides.
   */
  render<TPayload extends SlackNotificationPayload = SlackNotificationPayload>(
    input: SlackTemplateRenderInput<TPayload>,
  ): MaybePromise<SlackTemplateRenderResult>;
}

/** Notification payload understood by {@link SlackChannel} and {@link SlackService.sendNotification}. */
export interface SlackNotificationPayload extends Record<string, unknown> {
  attachments?: readonly SlackAttachment[];
  blocks?: readonly SlackBlock[];
  channel?: string;
  iconEmoji?: string;
  iconUrl?: string;
  metadata?: Record<string, unknown>;
  mrkdwn?: boolean;
  replyBroadcast?: boolean;
  text?: string;
  threadTs?: string;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
  username?: string;
}

/** Shared notification request subtype consumed by the Slack channel implementation. */
export interface SlackNotificationDispatchRequest extends NotificationDispatchRequest<SlackNotificationPayload> {
  channel: string;
}

/** Caller-visible result returned by standalone and notification-backed Slack delivery. */
export interface SlackSendResult extends SlackTransportReceipt {
  ok: boolean;
  warnings: readonly string[];
}

/** Failure entry returned by tolerant batch delivery. */
export interface SlackSendFailure {
  error: Error;
  message: SlackMessage;
}

/** Summary returned by {@link SlackService.sendMany}. */
export interface SlackSendBatchResult {
  failed: number;
  failures: readonly SlackSendFailure[];
  results: readonly SlackSendResult[];
  succeeded: number;
}

/** Additional send controls applied to one Slack delivery attempt. */
export interface SlackSendOptions {
  signal?: AbortSignal;
}

/** Additional controls applied to one batch send operation. */
export interface SlackSendManyOptions extends SlackSendOptions {
  continueOnError?: boolean;
}

/** Module options accepted by {@link SlackModule.forRoot} and `forRootAsync`. */
export interface SlackModuleOptions {
  defaultChannel?: string;
  notifications?: {
    channel?: string;
  };
  renderer?: SlackTemplateRenderer;
  transport: SlackTransport | SlackTransportFactory;
  verifyOnModuleInit?: boolean;
}

/** Async registration options for Slack modules that derive config through DI. */
export type SlackAsyncModuleOptions = AsyncModuleOptions<SlackModuleOptions>;

/** Normalized module options resolved once during module registration. */
export interface NormalizedSlackModuleOptions {
  defaultChannel?: string;
  notifications: {
    channel: string;
  };
  renderer?: SlackTemplateRenderer;
  transport: {
    create: () => Promise<SlackTransport>;
    kind: string;
    ownsResources: boolean;
  };
  verifyOnModuleInit: boolean;
}

/** Slack facade exposed to application code and the compatibility token. */
export interface Slack {
  /**
   * Sends one Slack message directly through the configured transport.
   *
   * @param message Caller-supplied Slack message with text and/or block content.
   * @param options Optional abort signal propagated to the transport.
   * @returns A normalized delivery receipt describing the transport response.
   */
  send(message: SlackMessage, options?: SlackSendOptions): Promise<SlackSendResult>;

  /**
   * Sends multiple Slack messages in input order with optional tolerant failure handling.
   *
   * @param messages Ordered message list to deliver through the configured transport.
   * @param options Optional tolerant batch controls such as `continueOnError`.
   * @returns A batch summary containing successes and any captured failures.
   */
  sendMany(messages: readonly SlackMessage[], options?: SlackSendManyOptions): Promise<SlackSendBatchResult>;

  /**
   * Converts one notifications foundation request into a concrete Slack delivery.
   *
   * @param notification Shared notification envelope interpreted by the Slack package.
   * @param options Optional abort signal propagated to rendering and transport work.
   * @returns A normalized delivery receipt for the resulting Slack message.
   */
  sendNotification(
    notification: SlackNotificationDispatchRequest,
    options?: SlackSendOptions,
  ): Promise<SlackSendResult>;
}
