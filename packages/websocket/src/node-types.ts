import type { IncomingMessage } from 'node:http';

import type { WebSocket } from 'ws';

export type TypedOnMessageHandler<TEvents extends Record<string, unknown>, K extends keyof TEvents> = (
  payload: TEvents[K],
  socket: WebSocket,
  request: IncomingMessage,
) => void | Promise<void>;

export interface WebSocketGatewayContext {
  request: IncomingMessage;
  socket: WebSocket;
}

export interface WebSocketModuleOptions {
  backpressure?: {
    maxBufferedAmountBytes?: number;
    policy?: 'close' | 'drop';
  };
  buffer?: {
    maxPendingMessagesPerSocket?: number;
    overflowPolicy?: 'close' | 'drop-newest' | 'drop-oldest';
  };
  heartbeat?: {
    enabled?: boolean;
    intervalMs?: number;
    timeoutMs?: number;
  };
  shutdown?: {
    timeoutMs?: number;
  };
}
