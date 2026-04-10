import { Inject } from '@konekti/core';
import type { NotificationChannel, NotificationChannelContext, NotificationChannelDelivery } from '@konekti/notifications';

import { SlackTransportError } from './errors.js';
import { SlackService } from './service.js';
import { SLACK_OPTIONS } from './tokens.js';
import type { NormalizedSlackModuleOptions, SlackNotificationDispatchRequest, SlackSendResult } from './types.js';

/**
 * Notification channel implementation that bridges `@konekti/notifications` to {@link SlackService}.
 *
 * @remarks
 * This class keeps the foundation package channel-agnostic while allowing `@konekti/slack`
 * to interpret Slack-specific payload fields, webhook delivery, and transport behavior.
 */
@Inject(SlackService, SLACK_OPTIONS)
export class SlackChannel implements NotificationChannel<SlackNotificationDispatchRequest, SlackSendResult> {
  readonly channel: string;

  constructor(
    private readonly slack: SlackService,
    options: NormalizedSlackModuleOptions,
  ) {
    this.channel = options.notifications.channel;
  }

  /**
   * Sends one notifications foundation request through the configured Slack transport.
   *
   * @param notification Shared notification envelope understood by the Slack package.
   * @param context Optional abort context propagated from the notifications service.
   * @returns A normalized channel delivery result with the provider message timestamp exposed as `externalId` when available.
   */
  async send(
    notification: SlackNotificationDispatchRequest,
    context: NotificationChannelContext,
  ): Promise<NotificationChannelDelivery<SlackSendResult>> {
    const receipt = await this.slack.sendNotification(notification, { signal: context.signal });

    if (receipt.ok === false) {
      throw new SlackTransportError(
        `Slack transport reported an unsuccessful delivery${receipt.response ? `: ${receipt.response}` : '.'}`,
      );
    }

    return {
      externalId: receipt.messageTs,
      metadata: {
        channel: receipt.channel,
        response: receipt.response,
        statusCode: receipt.statusCode,
        warnings: receipt.warnings,
      },
      receipt,
      status: 'delivered',
    };
  }
}
