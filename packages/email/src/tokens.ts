import type { Token } from '@fluojs/core';
import type { NotificationChannel } from '@fluojs/notifications';

import type { EmailNotificationDispatchRequest, NormalizedEmailModuleOptions } from './types.js';

/** Injection token for the channel implementation consumed by `@fluojs/notifications`. */
export const EMAIL_CHANNEL: Token<NotificationChannel<EmailNotificationDispatchRequest>> = Symbol.for('fluo.email.channel');
/** Injection token for normalized email module options consumed internally by providers. */
export const EMAIL_OPTIONS: Token<NormalizedEmailModuleOptions> = Symbol.for('fluo.email.options');
