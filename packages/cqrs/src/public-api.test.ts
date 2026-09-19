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
    expect(cqrsPublicApi).toHaveProperty('CommandHandler');
    expect(cqrsPublicApi).toHaveProperty('QueryHandler');
    expect(cqrsPublicApi).toHaveProperty('EventHandler');
    expect(cqrsPublicApi).toHaveProperty('Saga');
    expect(cqrsPublicApi).toHaveProperty('CommandHandlerNotFoundException');
    expect(cqrsPublicApi).toHaveProperty('QueryHandlerNotFoundException');
    expect(cqrsPublicApi).toHaveProperty('SagaTopologyError');
  });

  it('keeps compatibility registration and integration assembly off the root barrel', () => {
    expect(cqrsPublicApi).not.toHaveProperty('createCqrsProviders');
    expect(cqrsPublicApi).not.toHaveProperty('COMMAND_BUS');
    expect(cqrsPublicApi).not.toHaveProperty('QUERY_BUS');
    expect(cqrsPublicApi).not.toHaveProperty('EVENT_BUS');
    expect(cqrsPublicApi).not.toHaveProperty('createCqrsPlatformStatusSnapshot');
    expect(cqrsPublicApi).not.toHaveProperty('DuplicateEventHandlerError');
    expect(cqrsPublicApi).not.toHaveProperty('commandHandlerMetadataSymbol');
    expect(cqrsPublicApi).not.toHaveProperty('queryHandlerMetadataSymbol');
    expect(cqrsPublicApi).not.toHaveProperty('eventHandlerMetadataSymbol');
    expect(cqrsPublicApi).not.toHaveProperty('sagaMetadataSymbol');
    expect(cqrsPublicApi).not.toHaveProperty('defineCommandHandlerMetadata');
    expect(cqrsPublicApi).not.toHaveProperty('defineQueryHandlerMetadata');
    expect(cqrsPublicApi).not.toHaveProperty('defineEventHandlerMetadata');
    expect(cqrsPublicApi).not.toHaveProperty('defineSagaMetadata');
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
