import { Inject } from '@fluojs/core';
import type { NotificationChannel, NotificationChannelDelivery, NotificationChannelContext } from '@fluojs/notifications';

import { EmailService } from './service.js';
import { EMAIL_OPTIONS } from './tokens.js';
import type { EmailNotificationDispatchRequest, EmailSendResult, NormalizedEmailModuleOptions } from './types.js';

function createIncompleteDeliveryError(receipt: EmailSendResult): Error {
  const error = new Error(
    `Email transport reported an incomplete delivery (accepted=${String(receipt.accepted.length)}, pending=${String(receipt.pending.length)}, rejected=${String(receipt.rejected.length)}).`,
  );
  error.name = 'EmailDeliveryError';
  return error;
}

/**
 * Notification channel implementation that bridges `@fluojs/notifications` to {@link EmailService}.
 *
 * @remarks
 * This class keeps the foundation package channel-agnostic while allowing `@fluojs/email`
 * to interpret email-specific payload fields, template rendering, and transport delivery.
 */
@Inject(EmailService, EMAIL_OPTIONS)
export class EmailChannel implements NotificationChannel<EmailNotificationDispatchRequest, EmailSendResult> {
  readonly channel: string;

  constructor(
    private readonly email: EmailService,
    options: NormalizedEmailModuleOptions,
  ) {
    this.channel = options.notifications.channel;
  }

  /**
   * Sends one notifications foundation request through the configured email transport.
   *
   * @param notification Shared notification envelope understood by the email package.
   * @param context Optional abort context propagated from the notifications service.
   * @returns A normalized channel delivery result with the provider message id exposed as `externalId`.
   */
  async send(
    notification: EmailNotificationDispatchRequest,
    context: NotificationChannelContext,
  ): Promise<NotificationChannelDelivery<EmailSendResult>> {
    const receipt = await this.email.sendNotification(notification, { signal: context.signal });

    if (receipt.accepted.length === 0 || receipt.pending.length > 0 || receipt.rejected.length > 0) {
      throw createIncompleteDeliveryError(receipt);
    }

    return {
      externalId: receipt.messageId,
      metadata: {
        accepted: receipt.accepted,
        pending: receipt.pending,
        rejected: receipt.rejected,
        response: receipt.response,
      },
      receipt,
      status: 'delivered',
    };
  }
}
