import type { Token } from '@fluojs/core';
import type { NotificationChannel } from '@fluojs/notifications';

import type { Discord, DiscordNotificationDispatchRequest, NormalizedDiscordModuleOptions } from './types.js';

/** Compatibility token for the facade returned by {@link DiscordModule.forRoot}. */
export const DISCORD: Token<Discord> = Symbol.for('konekti.discord');
/** Injection token for the channel implementation consumed by `@fluojs/notifications`. */
export const DISCORD_CHANNEL: Token<NotificationChannel<DiscordNotificationDispatchRequest>> = Symbol.for(
  'konekti.discord.channel',
);
/** Injection token for normalized Discord module options consumed internally by providers. */
export const DISCORD_OPTIONS: Token<NormalizedDiscordModuleOptions> = Symbol.for('konekti.discord.options');
