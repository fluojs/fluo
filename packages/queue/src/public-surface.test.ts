import { describe, expect, it } from 'vitest';

import * as queue from './index.js';

describe('@konekti/queue root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(Object.keys(queue).sort()).toMatchSnapshot();
  });
});
