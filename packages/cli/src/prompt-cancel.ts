/**
 * Stable sentinel error for caller-owned prompt cancellation.
 *
 * @remarks
 * Programmatic prompt hooks passed to `runCli(...)` or `runNewCommand(...)`
 * can throw this error to report a normal user cancellation without relying on
 * CLI internals or terminating the host process.
 *
 * @example
 * ```ts
 * import { CliPromptCancelledError, runNewCommand } from '@fluojs/cli';
 *
 * const exitCode = await runNewCommand([], {
 *   interactive: true,
 *   prompt: {
 *     async text() {
 *       throw new CliPromptCancelledError();
 *     },
 *     async select(_message, _choices, defaultValue) {
 *       return defaultValue ?? 'pnpm';
 *     },
 *     async confirm(_message, defaultValue) {
 *       return defaultValue;
 *     },
 *   },
 * });
 * ```
 */
export class CliPromptCancelledError extends Error {
  /**
   * Creates a prompt cancellation sentinel.
   *
   * @param message Optional cancellation message for diagnostics.
   */
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
