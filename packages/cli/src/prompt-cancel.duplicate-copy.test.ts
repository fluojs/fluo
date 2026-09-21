import { describe, expect, it, vi } from 'vitest';

import { CliPromptCancelledError } from './prompt-cancel.js';

describe('CLI prompt cancellation duplicate-copy contract', () => {
  it('recognizes a cancellation sentinel produced by a separate module copy', async () => {
    const duplicateCopyError = new CliPromptCancelledError();
    vi.resetModules();
    const { CliPromptCancelledError: currentError, isCliPromptCancelledError } = await import('./prompt-cancel.js');

    expect(duplicateCopyError).not.toBeInstanceOf(currentError);
    expect(isCliPromptCancelledError(duplicateCopyError)).toBe(true);
  });
});
