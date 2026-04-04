import { describe, expect, it } from 'vitest';

import * as eventBus from './index.js';

describe('@konekti/event-bus root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(Object.keys(eventBus).sort()).toMatchSnapshot();
  });
});
