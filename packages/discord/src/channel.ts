import { Inject } from '@fluojs/core';
import type { NotificationChannel, NotificationChannelContext, NotificationChannelDelivery } from '@fluojs/notifications';

import { DiscordTransportError } from './errors.js';
import { DiscordService } from './service.js';
import { DISCORD_OPTIONS } from './tokens.js';
import type { DiscordNotificationDispatchRequest, DiscordSendResult, NormalizedDiscordModuleOptions } from './types.js';

/**
 * Notification channel implementation that bridges `@fluojs/notifications` to {@link DiscordService}.
 *
 * @remarks
 * This class keeps the foundation package channel-agnostic while allowing `@fluojs/discord`
 * to interpret Discord-specific payload fields, webhook delivery, and transport behavior.
 */
@Inject(DiscordService, DISCORD_OPTIONS)
export class DiscordChannel implements NotificationChannel<DiscordNotificationDispatchRequest, DiscordSendResult> {
  readonly channel: string;

  constructor(
    private readonly discord: DiscordService,
    options: NormalizedDiscordModuleOptions,
  ) {
    this.channel = options.notifications.channel;
  }

  /**
   * Sends one notifications foundation request through the configured Discord transport.
   *
   * @param notification Shared notification envelope understood by the Discord package.
   * @param context Optional abort context propagated from the notifications service.
   * @returns A normalized channel delivery result with the provider message id exposed as `externalId` when available.
   */
  async send(
    notification: DiscordNotificationDispatchRequest,
    context: NotificationChannelContext,
  ): Promise<NotificationChannelDelivery<DiscordSendResult>> {
    const receipt = await this.discord.sendNotification(notification, { signal: context.signal });

    if (receipt.ok === false) {
      throw new DiscordTransportError('Discord transport reported an unsuccessful delivery.');
    }

    return {
      externalId: receipt.messageId,
      metadata: {
        channelId: receipt.channelId,
        guildId: receipt.guildId,
        response: receipt.response,
        statusCode: receipt.statusCode,
        threadId: receipt.threadId,
        warnings: receipt.warnings,
      },
      receipt,
      status: 'delivered',
    };
  }
}
