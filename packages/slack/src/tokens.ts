import type { Token } from '@fluojs/core';
import type { NotificationChannel } from '@fluojs/notifications';

import type { NormalizedSlackModuleOptions, SlackNotificationDispatchRequest } from './types.js';

/** Injection token for the channel implementation consumed by `@fluojs/notifications`. */
export const SLACK_CHANNEL: Token<NotificationChannel<SlackNotificationDispatchRequest>> = Symbol.for('fluo.slack.channel');
/** Injection token for normalized Slack module options consumed internally by providers. */
export const SLACK_OPTIONS: Token<NormalizedSlackModuleOptions> = Symbol.for('fluo.slack.options');
