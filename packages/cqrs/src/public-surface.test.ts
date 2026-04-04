import { describe, expect, it } from 'vitest';

import * as cqrs from './index.js';

describe('@konekti/cqrs root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(Object.keys(cqrs).sort()).toMatchSnapshot();
    expect(cqrs).not.toHaveProperty('CQRS_EVENT_BUS');
  });
});
