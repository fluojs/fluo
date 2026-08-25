import type { ApplicationLogger } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { OnMessage } from './decorators.js';
import { dispatchGatewayMessage } from './internal/shared.js';
import { getWebSocketHandlerMetadataEntries } from './metadata.js';
import type { WebSocketGatewayDescriptor } from './types.js';

const logger: ApplicationLogger = {
  debug() {},
  error() {},
  log() {},
  warn() {},
};

class TestGatewayToken {}

function createDescriptor(instance: object): WebSocketGatewayDescriptor {
  const handler = {
    event: 'ping',
    methodKey: 'handlePing',
    methodName: 'handlePing',
    type: 'message',
  } as const;

  return {
    connectHandlers: [],
    disconnectHandlers: [],
    handlers: [handler],
    messageHandlersByEvent: new Map([['ping', [handler]]]),
    moduleName: 'TestModule',
    path: '/test',
    targetName: instance.constructor.name,
    token: TestGatewayToken,
    wildcardMessageHandlers: [],
  };
}

describe('websocket lifecycle metadata contracts', () => {
  it('keeps base handler metadata unchanged when a subclass adds a decorated handler', () => {
    // Given
    class BaseGateway {
      @OnMessage('base')
      handleBase(): void {}
    }

    const baseEntriesBefore = getWebSocketHandlerMetadataEntries(BaseGateway.prototype);

    // When
    class ChildGateway extends BaseGateway {
      @OnMessage('child')
      handleChild(): void {}
    }

    // Then
    expect(getWebSocketHandlerMetadataEntries(BaseGateway.prototype)).toEqual(baseEntriesBefore);
    expect(getWebSocketHandlerMetadataEntries(ChildGateway.prototype).map((entry) => entry.metadata.event)).toEqual([
      'base',
      'child',
    ]);
  });

  it('passes connection identity to message handlers', async () => {
    // Given
    const receivedSocketIds: string[] = [];
    const instance = {
      handlePing(_payload: unknown, _socket: unknown, _request: Request, socketId: string): void {
        receivedSocketIds.push(socketId);
      },
    };
    const descriptor = createDescriptor(instance);

    // When
    await dispatchGatewayMessage(
      [{ descriptor, instance }],
      { send() {} },
      new Request('https://test.invalid'),
      JSON.stringify({ data: 'payload', event: 'ping' }),
      'socket-1',
      undefined,
      logger,
      'Test',
    );

    // Then
    expect(receivedSocketIds).toEqual(['socket-1']);
  });

  it('ignores handler event-envelope returns by default', async () => {
    // Given
    const sent: string[] = [];
    const instance = {
      handlePing() {
        return { data: 'payload', event: 'pong' };
      },
    };
    const descriptor = createDescriptor(instance);

    // When
    await dispatchGatewayMessage(
      [{ descriptor, instance }],
      { send(message: string) { sent.push(message); } },
      new Request('https://test.invalid'),
      JSON.stringify({ event: 'ping' }),
      'socket-1',
      undefined,
      logger,
      'Test',
    );

    // Then
    expect(sent).toEqual([]);
  });

  it('sends handler event-envelope returns when replies are enabled', async () => {
    // Given
    const sent: string[] = [];
    const instance = {
      handlePing() {
        return { data: 'payload', event: 'pong' };
      },
    };
    const descriptor = createDescriptor(instance);

    // When
    await dispatchGatewayMessage(
      [{ descriptor, instance }],
      { send(message: string) { sent.push(message); } },
      new Request('https://test.invalid'),
      JSON.stringify({ event: 'ping' }),
      'socket-1',
      'event-envelope',
      logger,
      'Test',
    );

    // Then
    expect(sent).toEqual([JSON.stringify({ data: 'payload', event: 'pong' })]);
  });
});
