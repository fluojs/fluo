/** Configuration failure detected before an experimental Server Function registry is used. */
export class ReactServerFunctionConfigurationError extends Error {
  readonly name = 'ReactServerFunctionConfigurationError';
}

/** Client-side HTTP or serialization failure from an experimental Server Function call. */
export class ReactServerFunctionClientError extends Error {
  readonly name = 'ReactServerFunctionClientError';

  /**
   * Creates a typed client error without converting a failed response into an action result.
   *
   * @param message Human-readable transport failure.
   * @param status HTTP status, or zero when no valid HTTP response was available.
   * @param responseBody Parsed response body when one was available.
   */
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody?: unknown,
  ) {
    super(message);
  }
}
