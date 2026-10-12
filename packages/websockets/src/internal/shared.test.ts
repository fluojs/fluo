import { describe, expect, it } from 'vitest';

import { WebSocketRoomIndex } from './shared.js';

describe('WebSocketRoomIndex', () => {
  it('keeps duplicate joins idempotent and returns independent room snapshots', () => {
    const index = new WebSocketRoomIndex();
    index.join('first', 'shared');
    index.join('first', 'shared');
    const snapshot = index.getRooms('first');

    index.join('first', 'other');

    expect([...snapshot]).toEqual(['shared']);
    expect([...index.getRooms('first')]).toEqual(['shared', 'other']);
    expect([...(index.getSockets('shared') ?? [])]).toEqual(['first']);
    expect([...index.getRooms('unknown')]).toEqual([]);
  });

  it('removes one socket from every room while retaining other members', () => {
    const index = new WebSocketRoomIndex();
    index.join('first', 'shared');
    index.join('first', 'exclusive');
    index.join('second', 'shared');

    index.removeSocket('first');

    expect([...index.getRooms('first')]).toEqual([]);
    expect(index.getSockets('exclusive')).toBeUndefined();
    expect([...(index.getSockets('shared') ?? [])]).toEqual(['second']);
    expect([...index.getRooms('second')]).toEqual(['shared']);
  });

  it('cleans both indexes on repeated leave and permits rejoining an emptied room', () => {
    const index = new WebSocketRoomIndex();
    index.join('first', 'room');
    index.leave('first', 'room');
    index.leave('first', 'room');
    expect(index.getSockets('room')).toBeUndefined();
    expect([...index.getRooms('first')]).toEqual([]);

    index.join('second', 'room');

    expect([...(index.getSockets('room') ?? [])]).toEqual(['second']);
    expect([...index.getRooms('second')]).toEqual(['room']);
  });

  it('clears membership without mutating an earlier snapshot', () => {
    const index = new WebSocketRoomIndex();
    index.join('first', 'room');
    const snapshot = index.getRooms('first');

    index.clear();

    expect([...snapshot]).toEqual(['room']);
    expect([...index.getRooms('first')]).toEqual([]);
    expect(index.getSockets('room')).toBeUndefined();
  });
});
