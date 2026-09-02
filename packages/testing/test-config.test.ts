import { describe, expect, it } from 'vitest';

import config from './vitest.config.js';

describe('@fluojs/testing Vitest config', () => {
  it('runs test files serially while the package suite mutates dist', () => {
    expect(config.test?.fileParallelism).toBe(false);
  });
});
