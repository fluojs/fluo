import { describe, expect, it } from 'vitest';

import * as microservices from './index.js';

describe('@konekti/microservices root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(Object.keys(microservices).sort()).toMatchSnapshot();
  });
});
