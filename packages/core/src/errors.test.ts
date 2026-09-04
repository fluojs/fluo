import { describe, expect, it } from 'vitest';

import { FluoCodeError, FluoError, formatTokenName, InvariantError } from './errors.js';

class DatabaseError extends FluoCodeError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR');
  }
}

describe('public core errors', () => {
  it('preserves the default code, name, metadata, and Error cause', () => {
    // Given
    const cause = new Error('connection refused');
    const meta = { operation: 'connect' };

    // When
    const error = new FluoError('database unavailable', { cause, meta });

    // Then
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('FluoError');
    expect(error.message).toBe('database unavailable');
    expect(error.code).toBe('FLUO_ERROR');
    expect(error.cause).toBe(cause);
    expect(error.meta).toBe(meta);
  });

  it('preserves a non-Error cause without making it enumerable', () => {
    // Given
    const cause = { reason: 'offline' };

    // When
    const error = new FluoError('database unavailable', {
      cause,
      code: 'DATABASE_UNAVAILABLE',
    });

    // Then
    expect(error.code).toBe('DATABASE_UNAVAILABLE');
    expect(error.cause).toBe(cause);
    expect(Object.keys(error)).not.toContain('cause');
  });

  it('uses the fixed invariant code and subclass name', () => {
    // Given
    const meta = { invariant: 'container-ready' };

    // When
    const error = new InvariantError('container is not ready', { meta });

    // Then
    expect(error.name).toBe('InvariantError');
    expect(error.code).toBe('INVARIANT_ERROR');
    expect(error.meta).toBe(meta);
  });

  it('uses the code supplied by a FluoCodeError subclass', () => {
    // Given
    const message = 'database unavailable';

    // When
    const error = new DatabaseError(message);

    // Then
    expect(error.name).toBe('DatabaseError');
    expect(error.code).toBe('DATABASE_ERROR');
    expect(error.message).toBe(message);
  });
});

describe('formatTokenName', () => {
  it.each([
    [class UserService {}, 'UserService'],
    [Symbol('user'), 'Symbol(user)'],
    ['user', 'user'],
    [42, '42'],
    [true, 'true'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('formats %s as %s', (token, expected) => {
    // Given
    const injectionToken = token;

    // When
    const formatted = formatTokenName(injectionToken);

    // Then
    expect(formatted).toBe(expected);
  });
});
