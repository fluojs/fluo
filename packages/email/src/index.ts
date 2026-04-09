export {
  EmailConfigurationError,
  EmailMessageValidationError,
} from './errors.js';
export { EmailChannel } from './channel.js';
export { DEFAULT_EMAIL_QUEUE_WORKER_OPTIONS } from './constants.js';
export { EmailModule, createEmailProviders } from './module.js';
export { createEmailNotificationsQueueAdapter } from './queue.js';
export { EmailService } from './service.js';
export { createEmailPlatformStatusSnapshot } from './status.js';
export type { EmailLifecycleState, EmailPlatformStatusSnapshot, EmailStatusAdapterInput } from './status.js';
export { EMAIL, EMAIL_CHANNEL } from './tokens.js';
export type {
  Email,
  EmailAddress,
  EmailAddressLike,
  EmailAsyncModuleOptions,
  EmailAttachment,
  EmailMessage,
  EmailModuleOptions,
  EmailNotificationDispatchRequest,
  EmailNotificationPayload,
  EmailQueueWorkerOptions,
  EmailSendBatchResult,
  EmailSendFailure,
  EmailSendManyOptions,
  EmailSendOptions,
  EmailSendResult,
  EmailTemplateRenderInput,
  EmailTemplateRenderer,
  EmailTemplateRenderResult,
  EmailTransport,
  EmailTransportContext,
  EmailTransportFactory,
  EmailTransportReceipt,
} from './types.js';
