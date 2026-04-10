import type { AsyncModuleOptions, MaybePromise } from '@fluojs/core';
import type { NotificationDispatchRequest } from '@fluojs/notifications';

/** Opaque Discord embed object forwarded to one transport implementation. */
export type DiscordEmbed = Readonly<Record<string, unknown>>;

/** Opaque Discord component object forwarded to one transport implementation. */
export type DiscordComponent = Readonly<Record<string, unknown>>;

/** Opaque Discord attachment object forwarded to one transport implementation. */
export type DiscordAttachment = Readonly<Record<string, unknown>>;

/** Opaque Discord poll object forwarded to one transport implementation. */
export type DiscordPoll = Readonly<Record<string, unknown>>;

/** Opaque Discord allowed-mentions object forwarded to one transport implementation. */
export type DiscordAllowedMentions = Readonly<Record<string, unknown>>;

/** Caller-supplied Discord message shape used for standalone delivery. */
export interface DiscordMessage {
  allowedMentions?: DiscordAllowedMentions;
  attachments?: readonly DiscordAttachment[];
  avatarUrl?: string;
  components?: readonly DiscordComponent[];
  content?: string;
  embeds?: readonly DiscordEmbed[];
  flags?: number;
  metadata?: Record<string, unknown>;
  poll?: DiscordPoll;
  threadId?: string;
  threadName?: string;
  tts?: boolean;
  username?: string;
}

/** Normalized Discord message passed to one transport implementation. */
export interface NormalizedDiscordMessage {
  allowedMentions?: DiscordAllowedMentions;
  attachments: readonly DiscordAttachment[];
  avatarUrl?: string;
  components: readonly DiscordComponent[];
  content?: string;
  embeds: readonly DiscordEmbed[];
  flags?: number;
  metadata?: Record<string, unknown>;
  poll?: DiscordPoll;
  threadId?: string;
  threadName?: string;
  tts?: boolean;
  username?: string;
}

/** Context object forwarded to transport implementations per delivery attempt. */
export interface DiscordTransportContext {
  signal?: AbortSignal;
}

/** Provider-specific receipt returned by one Discord transport. */
export interface DiscordTransportReceipt {
  channelId?: string;
  guildId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
  ok?: boolean;
  response?: string;
  statusCode?: number;
  threadId?: string;
  warnings?: readonly string[];
}

/** Transport contract implemented by runtime-specific or provider-specific Discord adapters. */
export interface DiscordTransport {
  /**
   * Sends one normalized Discord message.
   *
   * @param message Normalized message with resolved defaults and one target webhook/thread route.
   * @param context Optional abort context propagated from the caller.
   * @returns Provider-specific receipt details normalized for the Konekti Discord contract.
   */
  send(message: NormalizedDiscordMessage, context: DiscordTransportContext): Promise<DiscordTransportReceipt>;

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
export interface DiscordTransportFactory {
  /**
   * Creates the transport instance used by {@link DiscordService}.
   *
   * @returns The transport implementation that will own Discord delivery.
   */
  create(): MaybePromise<DiscordTransport>;

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
export interface DiscordFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  text(): MaybePromise<string>;
}

/** Minimal fetch-compatible function signature used by the built-in webhook transport helper. */
export type DiscordFetchLike = (input: string, init?: {
  body?: string;
  headers?: Readonly<Record<string, string>>;
  method?: string;
  signal?: AbortSignal;
}) => MaybePromise<DiscordFetchResponse>;

/** Options accepted by {@link createDiscordWebhookTransport}. */
export interface DiscordWebhookTransportOptions {
  fetch?: DiscordFetchLike;
  wait?: boolean;
  webhookUrl: string;
}

/** Template render input used for `NotificationDispatchRequest.template` integration. */
export interface DiscordTemplateRenderInput<TPayload extends DiscordNotificationPayload = DiscordNotificationPayload> {
  locale?: string;
  metadata?: Record<string, unknown>;
  payload: TPayload;
  subject?: string;
  template: string;
}

/** Render result returned by an optional Discord template renderer. */
export interface DiscordTemplateRenderResult {
  components?: readonly DiscordComponent[];
  content?: string;
  embeds?: readonly DiscordEmbed[];
}

/** Optional renderer used to turn notification templates into concrete Discord content. */
export interface DiscordTemplateRenderer {
  /**
   * Renders one notification template into Discord content and/or embed fragments.
   *
   * @typeParam TPayload Payload shape carried by the notification request.
   * @param input Template render input including the template key and opaque payload.
   * @returns Rendered content or embed fragments that are merged with explicit payload overrides.
   */
  render<TPayload extends DiscordNotificationPayload = DiscordNotificationPayload>(
    input: DiscordTemplateRenderInput<TPayload>,
  ): MaybePromise<DiscordTemplateRenderResult>;
}

/** Notification payload understood by {@link DiscordChannel} and {@link DiscordService.sendNotification}. */
export interface DiscordNotificationPayload extends Record<string, unknown> {
  allowedMentions?: DiscordAllowedMentions;
  attachments?: readonly DiscordAttachment[];
  avatarUrl?: string;
  components?: readonly DiscordComponent[];
  content?: string;
  embeds?: readonly DiscordEmbed[];
  flags?: number;
  metadata?: Record<string, unknown>;
  poll?: DiscordPoll;
  threadId?: string;
  threadName?: string;
  tts?: boolean;
  username?: string;
}

/** Shared notification request subtype consumed by the Discord channel implementation. */
export interface DiscordNotificationDispatchRequest extends NotificationDispatchRequest<DiscordNotificationPayload> {
  channel: string;
}

/** Caller-visible result returned by standalone and notification-backed Discord delivery. */
export interface DiscordSendResult extends DiscordTransportReceipt {
  ok: boolean;
  warnings: readonly string[];
}

/** Failure entry returned by tolerant batch delivery. */
export interface DiscordSendFailure {
  error: Error;
  message: DiscordMessage;
}

/** Summary returned by {@link DiscordService.sendMany}. */
export interface DiscordSendBatchResult {
  failed: number;
  failures: readonly DiscordSendFailure[];
  results: readonly DiscordSendResult[];
  succeeded: number;
}

/** Additional send controls applied to one Discord delivery attempt. */
export interface DiscordSendOptions {
  signal?: AbortSignal;
}

/** Additional controls applied to one batch send operation. */
export interface DiscordSendManyOptions extends DiscordSendOptions {
  continueOnError?: boolean;
}

/** Module options accepted by {@link DiscordModule.forRoot} and `forRootAsync`. */
export interface DiscordModuleOptions {
  defaultThreadId?: string;
  notifications?: {
    channel?: string;
  };
  renderer?: DiscordTemplateRenderer;
  transport: DiscordTransport | DiscordTransportFactory;
  verifyOnModuleInit?: boolean;
}

/** Async registration options for Discord modules that derive config through DI. */
export type DiscordAsyncModuleOptions = AsyncModuleOptions<DiscordModuleOptions>;

/** Normalized module options resolved once during module registration. */
export interface NormalizedDiscordModuleOptions {
  defaultThreadId?: string;
  notifications: {
    channel: string;
  };
  renderer?: DiscordTemplateRenderer;
  transport: {
    create: () => Promise<DiscordTransport>;
    kind: string;
    ownsResources: boolean;
  };
  verifyOnModuleInit: boolean;
}

/** Discord facade exposed to application code and the compatibility token. */
export interface Discord {
  /**
   * Sends one Discord message directly through the configured transport.
   *
   * @param message Caller-supplied Discord message with content, embeds, or component payloads.
   * @param options Optional abort signal propagated to the transport.
   * @returns A normalized delivery receipt describing the transport response.
   */
  send(message: DiscordMessage, options?: DiscordSendOptions): Promise<DiscordSendResult>;

  /**
   * Sends multiple Discord messages in input order with optional tolerant failure handling.
   *
   * @param messages Ordered message list to deliver through the configured transport.
   * @param options Optional tolerant batch controls such as `continueOnError`.
   * @returns A batch summary containing successes and any captured failures.
   */
  sendMany(messages: readonly DiscordMessage[], options?: DiscordSendManyOptions): Promise<DiscordSendBatchResult>;

  /**
   * Converts one notifications foundation request into a concrete Discord delivery.
   *
   * @param notification Shared notification envelope interpreted by the Discord package.
   * @param options Optional abort signal propagated to rendering and transport work.
   * @returns A normalized delivery receipt for the resulting Discord message.
   */
  sendNotification(
    notification: DiscordNotificationDispatchRequest,
    options?: DiscordSendOptions,
  ): Promise<DiscordSendResult>;
}
