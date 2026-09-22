import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import {
  discordFetch,
  emailTransport,
  lifecyclePublisher,
  NotifyOpsAppModule,
  slackFetch,
} from './notify-ops-app';

/**
 * Cross-package composition evidence: one HTTP application where
 * @fluojs/email, @fluojs/slack, and @fluojs/discord register their channel
 * tokens into @fluojs/notifications, lifecycle events flow through the
 * publication seam, and @fluojs/terminus + @fluojs/metrics serve the ops
 * surface of the same app.
 */

describe('integrations package composition', () => {
  it('routes a notifications dispatch into the email transport', async () => {
    const app = await Test.createApp({ rootModule: NotifyOpsAppModule });
    try {
      const response = await app.request('POST', '/notify').body({ channel: 'email', text: 'Email body' }).send();

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ status: 'delivered' });
      expect(emailTransport.sent).toHaveLength(1);
      expect(emailTransport.sent[0]?.subject).toBe('Ops notification');
      expect(emailTransport.sent[0]?.text).toBe('Email body');
      expect(emailTransport.sent[0]?.to).toEqual([{ address: 'ops-target' }]);
    } finally {
      await app.close();
    }
  });

  it('routes the same dispatch shape into Slack and Discord webhooks', async () => {
    const app = await Test.createApp({ rootModule: NotifyOpsAppModule });
    try {
      const slackResponse = await app.request('POST', '/notify').body({ channel: 'slack', text: 'To Slack' }).send();
      expect(slackResponse.status).toBe(201);
      expect(slackResponse.body).toEqual({ status: 'delivered' });
      expect(slackFetch.calls[0]?.body.channel).toBe('ops-target');
      expect(slackFetch.calls[0]?.body.text).toBe('To Slack');

      const discordResponse = await app
        .request('POST', '/notify')
        .body({ channel: 'discord', text: 'To Discord' })
        .send();
      expect(discordResponse.status).toBe(201);
      expect(discordResponse.body).toEqual({ status: 'delivered' });
      // The dispatch recipient becomes the webhook's thread route.
      expect(discordFetch.calls[0]?.url).toContain('thread_id=ops-target');
      expect(discordFetch.calls[0]?.body.content).toBe('To Discord');
    } finally {
      await app.close();
    }
  });

  it('publishes requested and delivered lifecycle events for a direct dispatch', async () => {
    const app = await Test.createApp({ rootModule: NotifyOpsAppModule });
    try {
      await app.request('POST', '/notify').body({ channel: 'email', text: 'Observed' }).send();

      expect(lifecyclePublisher.events.slice(-2)).toEqual([
        'notification.dispatch.requested',
        'notification.dispatch.delivered',
      ]);
    } finally {
      await app.close();
    }
  });

  it('serves a healthy /health and an admitting /ready over the composed graph', async () => {
    const app = await Test.createApp({ rootModule: NotifyOpsAppModule });
    try {
      const health = await app.request('GET', '/health').send();
      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({
        contributors: { up: ['app-state'], down: [] },
        status: 'ok',
      });

      const ready = await app.request('GET', '/ready').send();
      expect(ready.status).toBe(200);
      expect(ready.body).toEqual({ status: 'ready' });
    } finally {
      await app.close();
    }
  });

  it('scrapes HTTP instrumentation of the same app from /metrics', async () => {
    const app = await Test.createApp({ rootModule: NotifyOpsAppModule });
    try {
      await app.request('POST', '/notify').body({ channel: 'email', text: 'Counted' }).send();

      const scrape = await app.request('GET', '/metrics').send();
      expect(scrape.status).toBe(200);
      expect(scrape.body).toContain('fluo_metrics_registry_mode{mode="isolated"} 1');
      expect(scrape.body).toContain('http_requests_total{method="POST",path="/notify",status="201"} 1');
    } finally {
      await app.close();
    }
  });
});
