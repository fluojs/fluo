import { describe, expect, it } from 'vitest';

import {
  assertValidSocketIoModuleOptions,
  resolveSocketIoMaxHttpBufferSize,
  resolveSocketIoMaxPendingMessagesPerSocket,
  resolveSocketIoShutdownTimeoutMs,
} from './config.internal.js';
import { SocketIoModule } from './module.js';
import type { SocketIoModuleOptions } from './types.js';

describe('Socket.IO module option validation', () => {
  it.each([
    {
      expectedMessage: 'Socket.IO configuration engine.maxHttpBufferSize must be a positive integer when provided.',
      options: { engine: { maxHttpBufferSize: 0 } },
    },
    {
      expectedMessage: 'Socket.IO configuration engine.maxHttpBufferSize must be a positive integer when provided.',
      options: { engine: { maxHttpBufferSize: -1 } },
    },
    {
      expectedMessage: 'Socket.IO configuration engine.maxHttpBufferSize must be a positive integer when provided.',
      options: { engine: { maxHttpBufferSize: 1.5 } },
    },
    {
      expectedMessage: 'Socket.IO configuration buffer.maxPendingMessagesPerSocket must be a positive integer when provided.',
      options: { buffer: { maxPendingMessagesPerSocket: 1.5 } },
    },
    {
      expectedMessage: 'Socket.IO configuration buffer.maxPendingMessagesPerSocket must be a positive integer when provided.',
      options: { buffer: { maxPendingMessagesPerSocket: Number.POSITIVE_INFINITY } },
    },
    {
      expectedMessage: 'Socket.IO configuration shutdown.timeoutMs must be a positive integer when provided.',
      options: { shutdown: { timeoutMs: Number.NaN } },
    },
    {
      expectedMessage: 'Socket.IO configuration shutdown.timeoutMs must be a positive integer when provided.',
      options: { shutdown: { timeoutMs: 0 } },
    },
  ] satisfies Array<{ readonly expectedMessage: string; readonly options: SocketIoModuleOptions }>)(
    'rejects invalid explicit numeric config: $expectedMessage',
    ({ expectedMessage, options }) => {
      expect(() => SocketIoModule.forRoot(options)).toThrow(expectedMessage);
    },
  );

  it('keeps omitted numeric options on documented defaults', () => {
    const options: SocketIoModuleOptions = {};

    expect(() => assertValidSocketIoModuleOptions(options)).not.toThrow();
    expect(resolveSocketIoMaxHttpBufferSize(options)).toBe(1_048_576);
    expect(resolveSocketIoMaxPendingMessagesPerSocket(options)).toBe(128);
    expect(resolveSocketIoShutdownTimeoutMs(options)).toBe(5_000);
  });
});
