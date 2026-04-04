import { describe, expect, it } from 'vitest';

import * as cron from './index.js';

describe('@konekti/cron root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(Object.keys(cron).sort()).toMatchSnapshot();
  });
});
