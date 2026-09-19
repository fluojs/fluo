import type { Token } from '@fluojs/core';

import type { NormalizedNotificationsModuleOptions, NotificationChannel } from './types.js';

/** Injection token for the normalized channel registry exposed to sibling notification packages. */
export const NOTIFICATION_CHANNELS: Token<readonly NotificationChannel[]> = Symbol.for('fluo.notifications.channels');
/** Injection token for normalized notifications module options consumed by {@link NotificationsService}. */
export const NOTIFICATIONS_OPTIONS: Token<NormalizedNotificationsModuleOptions> = Symbol.for('fluo.notifications.options');
