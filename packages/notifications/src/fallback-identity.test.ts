import { describe, expect, it, vi } from 'vitest';

import { NotificationsService } from './service.js';
import type { NotificationChannel, NotificationsQueueAdapter, NotificationsQueueJob } from './types.js';

const fallbackChannel = {
  channel: 'email',
  async send() {
    return {};
  },
} satisfies NotificationChannel;

function createFallbackService(): NotificationsService {
  return new NotificationsService({ channels: [fallbackChannel] }, [fallbackChannel]);
}

describe('notification fallback identity', () => {
  it('keeps generated identities stable when host collation order changes', async () => {
    // Given
    const service = createFallbackService();
    const request = {
      channel: 'email',
      payload: { alpha: 'first', omega: 'last' },
    };
    const baseline = await service.dispatch(request);
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function reverseCodeUnitOrder(
      this: string,
      other: string,
    ): number {
      const left = String(this);

      if (left < other) {
        return 1;
      }

      if (left > other) {
        return -1;
      }

      return 0;
    });

    try {
      // When
      const hostOrdered = await service.dispatch(request);

      // Then
      expect(hostOrdered.deliveryId).toBe(baseline.deliveryId);
    } finally {
      localeCompare.mockRestore();
    }
  });

  it('assigns different generated identities to envelopes that collide under the previous digest', async () => {
    // Given
    const service = createFallbackService();

    // When
    const left = await service.dispatch({
      channel: 'email',
      payload: { template: 'collision-1s8rz1a-1qaiyl7' },
    });
    const right = await service.dispatch({
      channel: 'email',
      payload: { template: 'collision-led3n6-kp4jvq' },
    });

    // Then
    expect(right.deliveryId).not.toBe(left.deliveryId);
  });

  it('uses caller-provided notification ids when channels omit external ids', async () => {
    // Given
    const service = createFallbackService();

    // When
    const result = await service.dispatch({
      channel: 'email',
      id: 'caller-notification-id',
      payload: { template: 'caller-owned' },
    });

    // Then
    expect(result.deliveryId).toBe('caller-notification-id');
  });

  it('distinguishes binary generated identities while preserving equivalent ArrayBuffer and DataView values', async () => {
    // Given
    const queuedJobs: NotificationsQueueJob[] = [];
    const queue: NotificationsQueueAdapter = {
      async enqueue(job) {
        queuedJobs.push(job);

        return `queued:${queuedJobs.length}`;
      },
    };
    const queuedService = new NotificationsService(
      {
        channels: [fallbackChannel],
        queue: {
          adapter: queue,
          bulkThreshold: 1,
        },
      },
      [fallbackChannel],
    );
    const fallbackService = createFallbackService();
    const requests = [
      { channel: 'email', payload: { binary: new Uint8Array([1, 2]).buffer } },
      { channel: 'email', payload: { binary: new Uint8Array([1, 3]).buffer } },
      { channel: 'email', payload: { binary: new Uint8Array([1, 2]).buffer } },
      { channel: 'email', payload: { binary: new DataView(new Uint8Array([0, 1, 2, 0]).buffer, 1, 2) } },
      { channel: 'email', payload: { binary: new DataView(new Uint8Array([0, 1, 3, 0]).buffer, 1, 2) } },
      { channel: 'email', payload: { binary: new DataView(new Uint8Array([9, 1, 2, 8]).buffer, 1, 2) } },
      { channel: 'email', payload: { binary: new DataView(new Uint8Array([1, 2, 0]).buffer, 0, 2) } },
    ];

    // When
    for (const request of requests) {
      await queuedService.dispatch(request, { queue: true });
    }
    const fallbackResults = [];

    for (const request of requests) {
      fallbackResults.push(await fallbackService.dispatch(request));
    }

    const [queuedArrayBuffer, queuedChangedArrayBuffer, queuedEquivalentArrayBuffer, queuedDataView, queuedChangedDataView, queuedEquivalentDataView, queuedOffsetDataView] =
      queuedJobs.map((job) => job.id);
    const [fallbackArrayBuffer, fallbackChangedArrayBuffer, fallbackEquivalentArrayBuffer, fallbackDataView, fallbackChangedDataView, fallbackEquivalentDataView, fallbackOffsetDataView] =
      fallbackResults.map((result) => result.deliveryId);

    // Then
    expect(queuedChangedArrayBuffer).not.toBe(queuedArrayBuffer);
    expect(queuedEquivalentArrayBuffer).toBe(queuedArrayBuffer);
    expect(queuedChangedDataView).not.toBe(queuedDataView);
    expect(queuedEquivalentDataView).toBe(queuedDataView);
    expect(queuedOffsetDataView).not.toBe(queuedDataView);
    expect(fallbackChangedArrayBuffer).not.toBe(fallbackArrayBuffer);
    expect(fallbackEquivalentArrayBuffer).toBe(fallbackArrayBuffer);
    expect(fallbackChangedDataView).not.toBe(fallbackDataView);
    expect(fallbackEquivalentDataView).toBe(fallbackDataView);
    expect(fallbackOffsetDataView).not.toBe(fallbackDataView);
  });
});
