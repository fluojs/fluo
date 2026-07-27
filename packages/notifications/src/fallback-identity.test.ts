import { describe, expect, it, vi } from 'vitest';

import { NotificationsService } from './service.js';
import type { NotificationChannel } from './types.js';

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
});
