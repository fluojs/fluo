import { describe, expect, it } from 'vitest';

import * as cqrsPublicApi from './index.js';

describe('@konekti/cqrs public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(cqrsPublicApi).toHaveProperty('CqrsModule');
    expect(cqrsPublicApi).toHaveProperty('createCqrsProviders');
    expect(cqrsPublicApi).toHaveProperty('CommandBusLifecycleService');
    expect(cqrsPublicApi).toHaveProperty('QueryBusLifecycleService');
    expect(cqrsPublicApi).toHaveProperty('CqrsEventBusService');
    expect(cqrsPublicApi).toHaveProperty('COMMAND_BUS');
    expect(cqrsPublicApi).toHaveProperty('QUERY_BUS');
    expect(cqrsPublicApi).toHaveProperty('EVENT_BUS');
    expect(cqrsPublicApi).toHaveProperty('CommandHandler');
    expect(cqrsPublicApi).toHaveProperty('QueryHandler');
    expect(cqrsPublicApi).toHaveProperty('EventHandler');
    expect(cqrsPublicApi).toHaveProperty('Saga');
    expect(cqrsPublicApi).toHaveProperty('CommandHandlerNotFoundException');
    expect(cqrsPublicApi).toHaveProperty('QueryHandlerNotFoundException');
    expect(cqrsPublicApi).toHaveProperty('createCqrsPlatformStatusSnapshot');
  });

  it('does not expose removed legacy error aliases', () => {
    expect(cqrsPublicApi).not.toHaveProperty('CommandHandlerNotFoundError');
    expect(cqrsPublicApi).not.toHaveProperty('QueryHandlerNotFoundError');
  });
});
