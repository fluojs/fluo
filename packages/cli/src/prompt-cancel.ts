/** Error used when an interactive prompt is cancelled by the caller. */
export class CliPromptCancelledError extends Error {
  constructor(message = 'Operation cancelled.') {
    super(message);
    this.name = 'CliPromptCancelledError';
  }
}

/**
 * Checks whether a thrown value represents a user-cancelled CLI prompt.
 *
 * @param error Value caught from a command execution path.
 * @returns `true` when the value is a `CliPromptCancelledError`.
 */
export function isCliPromptCancelledError(error: unknown): error is CliPromptCancelledError {
  return error instanceof CliPromptCancelledError;
}
