import type { AsyncModuleOptions, MaybePromise } from '@fluojs/core';
import type { NotificationDispatchRequest } from '@fluojs/notifications';

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
   * @returns Provider-specific receipt details normalized for the Fluo Slack contract.
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
export type SlackFetchLike = (input: string, init?: {
    body?: string;
    headers?: Readonly<Record<string, string>>;
    method?: string;
    signal?: AbortSignal;
  }) => MaybePromise<SlackFetchResponse>;

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
  /**
   * Controls whether Slack providers are visible through the whole module graph.
   *
   * @remarks
   * Defaults to `true` for Nest-like root registration. Set `false` when migrated code needs `SlackService`,
   * `SlackChannel` and `SLACK_CHANNEL` to stay visible only to modules that explicitly import the returned
   * module definition.
   */
  global?: boolean;
  notifications?: {
    channel?: string;
  };
  renderer?: SlackTemplateRenderer;
  transport: SlackTransport | SlackTransportFactory;
  /**
   * Verifies the configured transport during `onModuleInit()` before the service becomes ready for delivery.
   */
  verifyOnModuleInit?: boolean;
}

/** Async registration options for Slack modules that derive config through DI. */
export type SlackAsyncModuleOptions = AsyncModuleOptions<Omit<SlackModuleOptions, 'global'>> & Pick<SlackModuleOptions, 'global'>;

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

