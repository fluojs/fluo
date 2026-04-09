import type { Token } from '@konekti/core';

import type { Notifications, NormalizedNotificationsModuleOptions, NotificationChannel } from './types.js';

/** Compatibility injection token for the facade returned by {@link NotificationsModule.forRoot}. */
export const NOTIFICATIONS: Token<Notifications> = Symbol.for('konekti.notifications');
/** Injection token for the normalized channel registry exposed to sibling notification packages. */
export const NOTIFICATION_CHANNELS: Token<readonly NotificationChannel[]> = Symbol.for('konekti.notifications.channels');
/** Injection token for normalized notifications module options consumed by {@link NotificationsService}. */
export const NOTIFICATIONS_OPTIONS: Token<NormalizedNotificationsModuleOptions> = Symbol.for('konekti.notifications.options');
