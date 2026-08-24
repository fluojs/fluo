import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const loaded: unknown = await import(
  resolve(process.cwd(), '.agents/workflow-contracts/contracts.mjs')
);
if (
  !isRecord(loaded) ||
  typeof loaded['assertContract'] !== 'function' ||
  typeof loaded['assertEventChain'] !== 'function' ||
  typeof loaded['hashEvent'] !== 'function'
) {
  throw new TypeError('Expected the shared event contract API.');
}
const assertContract = loaded['assertContract'];
const assertEventChain = loaded['assertEventChain'];
const hashEvent = loaded['hashEvent'];
const transitionModule: unknown = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/transition-application.mjs',
  )
);
if (
  !isRecord(transitionModule) ||
  typeof transitionModule['appendEvent'] !== 'function'
) {
  throw new TypeError('Expected the native event appender.');
}
const appendEvent = transitionModule['appendEvent'];

const eventWithoutHash = (
  sequence: number,
  previousHash: string | null,
): Readonly<Record<string, unknown>> => {
  const payload = { receipt_id: 'lane-4101:pr.merge' };
  return {
    version: 1,
    stream_id: 'lane-4101-runtime',
    sequence,
    previous_hash: previousHash,
    event_type: 'receipt.recorded',
    subject_id: 'lane-4101:pr.merge',
    payload,
    payload_sha256: createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex'),
    occurred_at: `2026-08-24T00:00:0${String(sequence)}.000Z`,
  };
};

const eventWithHash = (
  sequence: number,
  previousHash: string | null,
): Readonly<Record<string, unknown>> => {
  const event = eventWithoutHash(sequence, previousHash);
  return { ...event, event_hash: hashEvent(event) };
};

describe('OMO native append-only events', () => {
  it('accepts only sequenced, content-hashed, hash-linked events', () => {
    const first = eventWithHash(1, null);
    const firstHash = first['event_hash'];
    if (typeof firstHash !== 'string') {
      throw new TypeError('Expected the first event hash.');
    }
    const second = eventWithHash(2, firstHash);

    expect(() => assertContract('event', first)).not.toThrow();
    expect(() => assertEventChain([first, second])).not.toThrow();
    expect(() =>
      assertEventChain([{ ...first, subject_id: 'tampered' }, second]),
    ).toThrow(/event_hash/u);
    expect(() =>
      assertEventChain([
        { ...first, payload: { receipt_id: 'tampered' } },
        second,
      ]),
    ).toThrow(/payload_sha256/u);
    expect(() => assertEventChain([first, eventWithHash(3, firstHash)])).toThrow(
      /sequence/u,
    );
    expect(() =>
      assertEventChain([first, eventWithHash(2, 'f'.repeat(64))]),
    ).toThrow(/previous_hash/u);
  });

  it('keeps canonical timestamps after event 59', () => {
    const events: Readonly<Record<string, unknown>>[] = [];
    for (let sequence = 1; sequence <= 60; sequence += 1) {
      appendEvent(
        events,
        'lane-4101-runtime',
        'receipt.recorded',
        `receipt-${String(sequence)}`,
        { sequence },
      );
    }

    expect(() => assertEventChain(events)).not.toThrow();
    const occurredAt = events[59]?.['occurred_at'];
    expect(typeof occurredAt).toBe('string');
    if (typeof occurredAt !== 'string') {
      throw new TypeError('Expected event 60 timestamp.');
    }
    expect(new Date(occurredAt).toISOString()).toBe(occurredAt);
  });
});
