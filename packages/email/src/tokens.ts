import type { Token } from '@fluojs/core';
import type { NotificationChannel } from '@fluojs/notifications';

import type { Email, EmailNotificationDispatchRequest, NormalizedEmailModuleOptions } from './types.js';

/** Compatibility token for the facade returned by {@link EmailModule.forRoot}. */
export const EMAIL: Token<Email> = Symbol.for('konekti.email');
/** Injection token for the channel implementation consumed by `@fluojs/notifications`. */
export const EMAIL_CHANNEL: Token<NotificationChannel<EmailNotificationDispatchRequest>> = Symbol.for('konekti.email.channel');
/** Injection token for normalized email module options consumed internally by providers. */
export const EMAIL_OPTIONS: Token<NormalizedEmailModuleOptions> = Symbol.for('konekti.email.options');
