import { Inject, type Token } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { NotificationsModule } from './module.js';
import { NotificationsService } from './service.js';
import type { NotificationChannel, NotificationDispatchRequest, NotificationDispatchResult } from './types.js';

interface ApplicationNotificationSettings {
  readonly channel: NotificationChannel;
  readonly label: string;
  readonly shouldFail?: boolean;
}

const APPLICATION_NOTIFICATION_SETTINGS = Symbol(
  'application-notification-settings',
) as Token<ApplicationNotificationSettings>;

@Inject(NotificationsService)
class LocalNotificationsProbe {
  constructor(private readonly notifications: NotificationsService) {}

  dispatch(template: string): Promise<NotificationDispatchResult> {
    return this.notifications.dispatch({
      channel: 'email',
      payload: { template },
    });
  }
}

describe('NotificationsModule.forRootAsync application contexts', () => {
  it('isolates one async registration across concurrently bootstrapped application contexts', async () => {
    const factoryCalls: string[] = [];
    const firstDeliveries: string[] = [];
    const secondDeliveries: string[] = [];
    const registration = NotificationsModule.forRootAsync({
      global: false,
      inject: [APPLICATION_NOTIFICATION_SETTINGS],
      useFactory: async (...dependencies: unknown[]) => {
        const settings = dependencies[0] as ApplicationNotificationSettings;
        factoryCalls.push(settings.label);

        return { channels: [settings.channel] };
      },
    });

    class NotificationsOwnerModule {}
    defineModule(NotificationsOwnerModule, {
      imports: [registration],
      providers: [LocalNotificationsProbe],
    });

    class AppModule {}
    defineModule(AppModule, { imports: [NotificationsOwnerModule] });

    const [firstApp, secondApp] = await Promise.all([
      bootstrapApplication({
        providers: [
          {
            provide: APPLICATION_NOTIFICATION_SETTINGS,
            useValue: {
              channel: {
                channel: 'email',
                async send(notification: NotificationDispatchRequest) {
                  firstDeliveries.push(String(notification.payload.template));

                  return { externalId: 'first-application' };
                },
              },
              label: 'first',
            },
          },
        ],
        rootModule: AppModule,
      }),
      bootstrapApplication({
        providers: [
          {
            provide: APPLICATION_NOTIFICATION_SETTINGS,
            useValue: {
              channel: {
                channel: 'email',
                async send(notification: NotificationDispatchRequest) {
                  secondDeliveries.push(String(notification.payload.template));

                  return { externalId: 'second-application' };
                },
              },
              label: 'second',
            },
          },
        ],
        rootModule: AppModule,
      }),
    ]);

    try {
      const [firstProbe, secondProbe] = await Promise.all([
        firstApp.container.resolve(LocalNotificationsProbe),
        secondApp.container.resolve(LocalNotificationsProbe),
      ]);
      const [firstResult, secondResult] = await Promise.all([
        firstProbe.dispatch('first-template'),
        secondProbe.dispatch('second-template'),
      ]);

      expect(factoryCalls).toHaveLength(2);
      expect([...factoryCalls].sort()).toEqual(['first', 'second']);
      expect(firstResult).toMatchObject({ deliveryId: 'first-application', status: 'delivered' });
      expect(secondResult).toMatchObject({ deliveryId: 'second-application', status: 'delivered' });
      expect(firstDeliveries).toEqual(['first-template']);
      expect(secondDeliveries).toEqual(['second-template']);
    } finally {
      await Promise.all([firstApp.close(), secondApp.close()]);
    }
  });

  it('retries a failed async registration in a later application context', async () => {
    const factoryCalls: string[] = [];
    const registration = NotificationsModule.forRootAsync({
      global: false,
      inject: [APPLICATION_NOTIFICATION_SETTINGS],
      useFactory: async (...dependencies: unknown[]) => {
        const settings = dependencies[0] as ApplicationNotificationSettings;
        factoryCalls.push(settings.label);

        if (settings.shouldFail) {
          throw new Error(`notification settings failed:${settings.label}`);
        }

        return { channels: [settings.channel] };
      },
    });

    class NotificationsOwnerModule {}
    defineModule(NotificationsOwnerModule, {
      imports: [registration],
      providers: [LocalNotificationsProbe],
    });

    class AppModule {}
    defineModule(AppModule, { imports: [NotificationsOwnerModule] });

    await expect(
      bootstrapApplication({
        providers: [
          {
            provide: APPLICATION_NOTIFICATION_SETTINGS,
            useValue: {
              channel: {
                channel: 'email',
                async send() {
                  return { externalId: 'unreachable' };
                },
              },
              label: 'failed',
              shouldFail: true,
            },
          },
        ],
        rootModule: AppModule,
      }),
    ).rejects.toThrow('notification settings failed:failed');

    const app = await bootstrapApplication({
      providers: [
        {
          provide: APPLICATION_NOTIFICATION_SETTINGS,
          useValue: {
            channel: {
              channel: 'email',
              async send() {
                return { externalId: 'recovered-application' };
              },
            },
            label: 'recovered',
          },
        },
      ],
      rootModule: AppModule,
    });

    try {
      const probe = await app.container.resolve(LocalNotificationsProbe);

      await expect(probe.dispatch('recovered-template')).resolves.toMatchObject({
        deliveryId: 'recovered-application',
        status: 'delivered',
      });
      expect(factoryCalls).toEqual(['failed', 'recovered']);
    } finally {
      await app.close();
    }
  });
});
