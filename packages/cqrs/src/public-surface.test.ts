import { describe, expect, it } from 'vitest';

import * as cqrs from './index.js';

describe('@konekti/cqrs root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(cqrs).toHaveProperty('CqrsModule');
    expect(cqrs).not.toHaveProperty('createCqrsModule');
    expect(cqrs).toHaveProperty('createCqrsProviders');
    expect(cqrs).toHaveProperty('CommandBusLifecycleService');
    expect(cqrs).toHaveProperty('QueryBusLifecycleService');
    expect(cqrs).toHaveProperty('CqrsEventBusService');
    expect(cqrs).toHaveProperty('COMMAND_BUS');
    expect(cqrs).toHaveProperty('QUERY_BUS');
    expect(cqrs).toHaveProperty('EVENT_BUS');
    expect(cqrs).toHaveProperty('CommandHandler');
    expect(cqrs).toHaveProperty('QueryHandler');
    expect(cqrs).toHaveProperty('EventHandler');
    expect(cqrs).toHaveProperty('Saga');
    expect(cqrs).toHaveProperty('createCqrsPlatformStatusSnapshot');
    expect(cqrs).not.toHaveProperty('CommandHandlerNotFoundError');
    expect(cqrs).not.toHaveProperty('QueryHandlerNotFoundError');
    expect(Object.keys(cqrs).sort()).toMatchSnapshot();
    expect(cqrs).not.toHaveProperty('CQRS_EVENT_BUS');
  });
});
