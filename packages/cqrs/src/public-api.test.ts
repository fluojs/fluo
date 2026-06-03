import { describe, expect, expectTypeOf, it } from 'vitest';

import * as cqrsModuleSource from './module.js';
import * as cqrsPublicApi from './index.js';
import type { CqrsDispatchContext } from './index.js';

type PublicDispatchContextInternalKeys = Extract<keyof CqrsDispatchContext, 'activeRoutes' | 'depth' | 'path'>;

describe('@fluojs/cqrs public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(cqrsPublicApi).toHaveProperty('CqrsModule');
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
    expect(cqrsPublicApi).toHaveProperty('SagaTopologyError');
    expect(cqrsPublicApi).toHaveProperty('createCqrsPlatformStatusSnapshot');
  });

  it('hides low-level provider assembly from the root barrel', () => {
    expect(cqrsPublicApi).not.toHaveProperty('createCqrsProviders');
  });

  it('keeps low-level provider assembly private to the module implementation', () => {
    expect(cqrsModuleSource).not.toHaveProperty('createCqrsProviders');
  });

  it('keeps dispatch context topology state out of the public type surface', () => {
    expectTypeOf<PublicDispatchContextInternalKeys>().toEqualTypeOf<never>();
  });

  it('does not expose removed legacy error aliases', () => {
    expect(cqrsPublicApi).not.toHaveProperty('CommandHandlerNotFoundError');
    expect(cqrsPublicApi).not.toHaveProperty('QueryHandlerNotFoundError');
  });
});
