import { createServer } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startStudioSidecar, type StudioSidecar } from './sidecar.js';

const sidecars: StudioSidecar[] = [];

afterEach(async () => {
  while (sidecars.length > 0) {
    await sidecars.pop()?.close();
  }
});

async function startTestSidecar(): Promise<StudioSidecar> {
  const sidecar = await startStudioSidecar({ appId: 'test-app', heartbeatMs: 0, runtime: 'node' });
  sidecars.push(sidecar);
  return sidecar;
}

describe('Studio sidecar', () => {
  it('starts on localhost and exposes child runtime env injection', async () => {
    const sidecar = await startTestSidecar();

    expect(sidecar.host).toBe('127.0.0.1');
    expect(sidecar.port).toBeGreaterThan(0);
    expect(sidecar.url).toBe(`http://127.0.0.1:${String(sidecar.port)}`);
    expect(sidecar.env).toMatchObject({
      FLUO_STUDIO: '1',
      FLUO_STUDIO_APP_ID: 'test-app',
      FLUO_STUDIO_EPOCH: sidecar.epoch,
      FLUO_STUDIO_RUNTIME: 'node',
      FLUO_STUDIO_TOKEN: sidecar.token,
      FLUO_STUDIO_URL: sidecar.url,
    });
  });

  it('requires token auth for ingestion and state APIs', async () => {
    const sidecar = await startTestSidecar();

    const unauthorized = await fetch(`${sidecar.url}/api/state`);
    expect(unauthorized.status).toBe(401);

    const unauthorizedEvents = await fetch(`${sidecar.url}/api/events`);
    expect(unauthorizedEvents.status).toBe(401);
    await expect(unauthorizedEvents.json()).resolves.toMatchObject({ error: 'Unauthorized Studio sidecar request.' });

    const accepted = await fetch(`${sidecar.url}/api/runtime/events`, {
      body: JSON.stringify({ payload: { ok: true }, source: { appId: 'test-app', runtime: 'node' }, type: 'snapshot', version: 1 }),
      headers: {
        authorization: `Bearer ${sidecar.token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({ accepted: true, epoch: sidecar.epoch, sequence: 1 });

    const state = await fetch(`${sidecar.url}/api/state?token=${encodeURIComponent(sidecar.token)}`);
    await expect(state.json()).resolves.toMatchObject({
      appId: 'test-app',
      epoch: sidecar.epoch,
      events: [expect.objectContaining({ sequence: 1, type: 'snapshot' })],
      sequence: 1,
    });
  });

  it('replays accepted events over SSE with epoch and sequence ids', async () => {
    const sidecar = await startTestSidecar();
    await fetch(`${sidecar.url}/api/runtime/events`, {
      body: JSON.stringify({ payload: { graph: { nodes: [] } }, source: { appId: 'test-app', runtime: 'node' }, type: 'snapshot', version: 1 }),
      headers: {
        authorization: `Bearer ${sidecar.token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    const response = await fetch(`${sidecar.url}/api/events?token=${encodeURIComponent(sidecar.token)}`);
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const chunk = await reader!.read();
    await reader!.cancel();
    const text = new TextDecoder().decode(chunk.value);

    expect(text).toContain(': fluo studio stream ready');
    expect(text).toContain(`id: ${sidecar.epoch}:1`);
    expect(text).toContain('event: snapshot');
  });

  it('serves the Studio UI shell with injected sidecar URLs', async () => {
    const sidecar = await startTestSidecar();

    const response = await fetch(`${sidecar.url}/?token=${encodeURIComponent(sidecar.token)}`);
    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain('window.__FLUO_STUDIO__');
    expect(html).toContain(`/api/events?token=${encodeURIComponent(sidecar.token)}`);
    expect(html).toContain(`/api/state?token=${encodeURIComponent(sidecar.token)}`);
  });

  it('does not throw when asset paths contain malformed percent encoding', async () => {
    const sidecar = await startTestSidecar();

    const response = await fetch(`${sidecar.url}/assets/%E0%A4%A`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized Studio sidecar request.' });
  });

  it('does not start heartbeat timers when the sidecar fails to listen', async () => {
    const occupiedServer = createServer((_request, response) => {
      response.end('occupied');
    });
    await new Promise<void>((resolve, reject) => {
      occupiedServer.once('error', reject);
      occupiedServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = occupiedServer.address();
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve, reject) => occupiedServer.close((error) => error ? reject(error) : resolve()));
      throw new Error('Failed to allocate occupied test port.');
    }
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    try {
      await expect(startStudioSidecar({ appId: 'test-app', heartbeatMs: 1, port: address.port, runtime: 'node' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
      await new Promise<void>((resolve, reject) => occupiedServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('moves to a new app epoch when restart lifecycle events arrive', async () => {
    const sidecar = await startTestSidecar();
    const initialEpoch = sidecar.epoch;

    const accepted = await fetch(`${sidecar.url}/api/runtime/events`, {
      body: JSON.stringify({ payload: { phase: 'scheduled', reason: 'content changed' }, source: { appId: 'test-app', runtime: 'node' }, type: 'restart', version: 1 }),
      headers: {
        authorization: `Bearer ${sidecar.token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(accepted.status).toBe(202);
    expect(sidecar.epoch).not.toBe(initialEpoch);
    const state = await fetch(`${sidecar.url}/api/state?token=${encodeURIComponent(sidecar.token)}`);
    await expect(state.json()).resolves.toMatchObject({
      epoch: sidecar.epoch,
      events: [expect.objectContaining({ epoch: sidecar.epoch, type: 'restart' })],
    });
  });

  it('honors CLI-provided restart epochs for subsequent child injection', async () => {
    const sidecar = await startTestSidecar();
    const initialEpoch = sidecar.epoch;
    const nextEpoch = 'cli-restart-epoch';

    const accepted = await fetch(`${sidecar.url}/api/runtime/events`, {
      body: JSON.stringify({ payload: { epoch: nextEpoch, phase: 'scheduled', reason: 'content changed' }, source: { appId: 'test-app', runtime: 'node' }, type: 'restart', version: 1 }),
      headers: {
        authorization: `Bearer ${sidecar.token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    expect(accepted.status).toBe(202);
    expect(sidecar.epoch).not.toBe(initialEpoch);
    expect(sidecar.epoch).toBe(nextEpoch);
    expect(sidecar.env.FLUO_STUDIO_EPOCH).toBe(nextEpoch);
  });
});
