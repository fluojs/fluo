import type { SocketIoModuleOptions } from './types.js';

/** Default number of pre-connect Socket.IO messages buffered per socket. */
export const DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET = 128;

/** Default Engine.IO request path used by Socket.IO transports. */
export const DEFAULT_SOCKETIO_ENGINE_PATH = '/socket.io/';

/** Default maximum inbound Engine.IO payload size in bytes. */
export const DEFAULT_SOCKETIO_MAX_HTTP_BUFFER_SIZE = 1_048_576;

/** Default graceful Socket.IO shutdown timeout in milliseconds. */
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

/**
 * Assert that explicit Socket.IO numeric options are positive integers.
 *
 * @param options Module options supplied to `SocketIoModule.forRoot(...)`.
 */
export function assertValidSocketIoModuleOptions(options: SocketIoModuleOptions): void {
  assertOptionalPositiveInteger(options.engine?.maxHttpBufferSize, 'engine.maxHttpBufferSize');
  assertOptionalPositiveInteger(options.buffer?.maxPendingMessagesPerSocket, 'buffer.maxPendingMessagesPerSocket');
  assertOptionalPositiveInteger(options.shutdown?.timeoutMs, 'shutdown.timeoutMs');
}

/**
 * Resolve the effective Socket.IO Engine.IO payload bound.
 *
 * @param options Module options supplied to `SocketIoModule.forRoot(...)`.
 * @returns The explicit payload bound or the package default.
 */
export function resolveSocketIoMaxHttpBufferSize(options: SocketIoModuleOptions): number {
  return options.engine?.maxHttpBufferSize ?? DEFAULT_SOCKETIO_MAX_HTTP_BUFFER_SIZE;
}

/**
 * Resolve the effective pending-message buffer limit.
 *
 * @param options Module options supplied to `SocketIoModule.forRoot(...)`.
 * @returns The explicit per-socket buffer limit or the package default.
 */
export function resolveSocketIoMaxPendingMessagesPerSocket(options: SocketIoModuleOptions): number {
  return options.buffer?.maxPendingMessagesPerSocket ?? DEFAULT_MAX_PENDING_MESSAGES_PER_SOCKET;
}

/**
 * Resolve the effective Socket.IO shutdown timeout.
 *
 * @param options Module options supplied to `SocketIoModule.forRoot(...)`.
 * @returns The explicit shutdown timeout or the package default.
 */
export function resolveSocketIoShutdownTimeoutMs(options: SocketIoModuleOptions): number {
  return options.shutdown?.timeoutMs ?? DEFAULT_SOCKETIO_SHUTDOWN_TIMEOUT_MS;
}
