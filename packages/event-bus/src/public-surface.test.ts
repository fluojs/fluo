import { describe, expect, it } from 'vitest';

import * as eventBus from './index.js';

describe('@konekti/event-bus root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(eventBus).toHaveProperty('EventBusModule');
    expect(eventBus).not.toHaveProperty('createEventBusModule');
    expect(eventBus).toHaveProperty('createEventBusProviders');
    expect(eventBus).toHaveProperty('EVENT_BUS');
    expect(eventBus).not.toHaveProperty('EVENT_BUS_OPTIONS');
    expect(eventBus).toHaveProperty('OnEvent');
    expect(eventBus).toHaveProperty('createEventBusPlatformStatusSnapshot');
    expect(Object.keys(eventBus).sort()).toMatchSnapshot();
  });
});
