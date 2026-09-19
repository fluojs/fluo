import { describe, expect, it } from 'vitest';

import * as cqrs from './index.js';

describe('@fluojs/cqrs root barrel public surface', () => {
  it('exposes the canonical application API without compatibility facades', () => {
    expect(cqrs).toHaveProperty('CqrsModule');
    expect(cqrs).not.toHaveProperty('createCqrsModule');
    expect(cqrs).not.toHaveProperty('createCqrsProviders');
    expect(cqrs).toHaveProperty('CommandBusLifecycleService');
    expect(cqrs).toHaveProperty('QueryBusLifecycleService');
    expect(cqrs).toHaveProperty('CqrsEventBusService');
    expect(cqrs).not.toHaveProperty('COMMAND_BUS');
    expect(cqrs).not.toHaveProperty('QUERY_BUS');
    expect(cqrs).not.toHaveProperty('EVENT_BUS');
    expect(cqrs).toHaveProperty('CommandHandler');
    expect(cqrs).toHaveProperty('QueryHandler');
    expect(cqrs).toHaveProperty('EventHandler');
    expect(cqrs).toHaveProperty('Saga');
    expect(cqrs).toHaveProperty('SagaTopologyError');
    expect(cqrs).not.toHaveProperty('createCqrsPlatformStatusSnapshot');
    expect(cqrs).not.toHaveProperty('DuplicateEventHandlerError');
    expect(cqrs).not.toHaveProperty('commandHandlerMetadataSymbol');
    expect(cqrs).not.toHaveProperty('queryHandlerMetadataSymbol');
    expect(cqrs).not.toHaveProperty('eventHandlerMetadataSymbol');
    expect(cqrs).not.toHaveProperty('sagaMetadataSymbol');
    expect(cqrs).not.toHaveProperty('defineCommandHandlerMetadata');
    expect(cqrs).not.toHaveProperty('defineQueryHandlerMetadata');
    expect(cqrs).not.toHaveProperty('defineEventHandlerMetadata');
    expect(cqrs).not.toHaveProperty('defineSagaMetadata');
    expect(cqrs).not.toHaveProperty('CommandHandlerNotFoundError');
    expect(cqrs).not.toHaveProperty('QueryHandlerNotFoundError');
    expect(Object.keys(cqrs).sort()).toMatchSnapshot();
    expect(cqrs).not.toHaveProperty('CQRS_EVENT_BUS');
  });
});
