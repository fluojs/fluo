import type { SocketIoModuleOptions } from './types.js';

export const DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET = 128;
export const DEFAULT_SOCKETIO_ENGINE_PATH = '/socket.io/';
export const DEFAULT_SOCKETIO_MAX_HTTP_BUFFER_SIZE = 1_048_576;
export const DEFAULT_SOCKETIO_SHUTDOWN_TIMEOUT_MS = 5_000;

type NumericOptionPath =
  | 'buffer.maxPendingMessagesPerSocket'
  | 'engine.maxHttpBufferSize'
  | 'shutdown.timeoutMs';

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value > 0;
}

function assertOptionalPositiveInteger(value: unknown, path: NumericOptionPath): void {
  if (value === undefined || isPositiveInteger(value)) {
    return;
  }

  throw new Error(`Socket.IO configuration ${path} must be a positive integer when provided.`);
}

export function assertValidSocketIoModuleOptions(options: SocketIoModuleOptions): void {
  assertOptionalPositiveInteger(options.engine?.maxHttpBufferSize, 'engine.maxHttpBufferSize');
  assertOptionalPositiveInteger(options.buffer?.maxPendingMessagesPerSocket, 'buffer.maxPendingMessagesPerSocket');
  assertOptionalPositiveInteger(options.shutdown?.timeoutMs, 'shutdown.timeoutMs');
}

export function resolveSocketIoMaxHttpBufferSize(options: SocketIoModuleOptions): number {
  return options.engine?.maxHttpBufferSize ?? DEFAULT_SOCKETIO_MAX_HTTP_BUFFER_SIZE;
}

export function resolveSocketIoMaxPendingMessagesPerSocket(options: SocketIoModuleOptions): number {
  return options.buffer?.maxPendingMessagesPerSocket ?? DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET;
}

export function resolveSocketIoShutdownTimeoutMs(options: SocketIoModuleOptions): number {
  return options.shutdown?.timeoutMs ?? DEFAULT_SOCKETIO_SHUTDOWN_TIMEOUT_MS;
}
