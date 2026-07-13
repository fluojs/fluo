/** Error codes emitted when browser navigation cannot honor the client router contract. */
export type ReactClientNavigationErrorCode = 'browser-unavailable' | 'unsupported-destination';

/** Typed client navigation failure with a stable machine-readable code. */
export class ReactClientNavigationError extends Error {
  readonly code: ReactClientNavigationErrorCode;

  constructor(code: ReactClientNavigationErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ReactClientNavigationError';
  }
}

/** Error thrown when route hooks are rendered without a client router provider. */
export class ReactClientRouterContextError extends Error {
  constructor() {
    super('React client route hooks require ReactClientRouterProvider.');
    this.name = 'ReactClientRouterContextError';
  }
}
