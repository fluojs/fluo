import type { Token } from '@fluojs/core';
import type { NotificationChannel } from '@fluojs/notifications';

import type { NormalizedSlackModuleOptions, Slack, SlackNotificationDispatchRequest } from './types.js';

/** Compatibility token for the facade returned by {@link SlackModule.forRoot}. */
export const SLACK: Token<Slack> = Symbol.for('konekti.slack');
/** Injection token for the channel implementation consumed by `@fluojs/notifications`. */
export const SLACK_CHANNEL: Token<NotificationChannel<SlackNotificationDispatchRequest>> = Symbol.for('konekti.slack.channel');
/** Injection token for normalized Slack module options consumed internally by providers. */
export const SLACK_OPTIONS: Token<NormalizedSlackModuleOptions> = Symbol.for('konekti.slack.options');
