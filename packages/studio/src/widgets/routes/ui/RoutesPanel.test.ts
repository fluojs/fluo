// @vitest-environment happy-dom

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { parseStudioPayload, type StudioLiveSnapshot, validateStudioLiveEvent } from '../../../contracts.js';
import { initialStudioState, type StudioDashboardState } from '../../../entities/studio/model.js';
import { studioReducer } from '../../../features/live-connection/model/reducer.js';
import { RoutesPanel } from './RoutesPanel.js';

const liveEventBase = {
  emittedAt: '2026-09-04T00:00:01.000Z',
  epoch: 'epoch-test',
  eventId: 'epoch-test:1',
  sequence: 1,
  source: { appId: 'app-test', runtime: 'node' },
  type: 'snapshot',
  version: 1,
} as const;

function liveState(snapshot: StudioLiveSnapshot): StudioDashboardState {
  return studioReducer(initialStudioState, {
    event: validateStudioLiveEvent({ ...liveEventBase, payload: snapshot }),
    type: 'live-event',
  });
}

function staticState(snapshot: object): StudioDashboardState {
  return studioReducer(initialStudioState, {
    message: 'Diagnostics file loaded successfully.',
    parsed: parseStudioPayload(JSON.stringify(snapshot)),
    type: 'static-payload',
  });
}

describe('RoutesPanel', () => {
  it('renders custom route kinds distinctly while retaining built-in labels', async () => {
    const state: StudioDashboardState = {
      ...liveState({
        appId: 'app-test',
        diagnostics: [],
        generatedAt: '2026-09-04T00:00:00.000Z',
        graph: { edges: [], nodes: [] },
        requests: [],
        routes: [
          {
            controller: 'CustomPageController',
            handler: 'show',
            id: 'GET /custom CustomPageController show',
            kind: 'custom-page',
            method: 'GET',
            params: [],
            path: '/custom',
          },
          {
            controller: 'HttpController',
            handler: 'handle',
            id: 'GET /http HttpController handle',
            kind: 'http',
            method: 'GET',
            params: [],
            path: '/http',
          },
          {
            controller: 'ReactPageController',
            handler: 'show',
            id: 'GET /react ReactPageController show',
            kind: 'react-page',
            method: 'GET',
            params: [],
            path: '/react',
          },
        ],
        version: 1,
      }),
      selectedRouteId: 'GET /custom CustomPageController show',
    };
    const container = document.createElement('div');
    const root = createRoot(container);
    root.render(createElement(RoutesPanel, { dispatch: vi.fn(), state }));

    try {
      await vi.waitFor(() => {
        expect(container.querySelectorAll('.route-row')).toHaveLength(3);
      });

      expect(container.querySelector('.route-list')?.textContent).toContain('custom-page');
      expect(container.querySelector('.route-list')?.textContent).toContain('HTTP handler');
      expect(container.querySelector('.route-list')?.textContent).toContain('React page');
      expect(container.querySelector('.route-detail')?.textContent).toContain('kind: custom-page');
    } finally {
      root.unmount();
    }
  });

  it('selects explicitly correlated graph route nodes when labels and slugged route ids collide', async () => {
    // Given
    const dispatch = vi.fn();
    const state = liveState({
      appId: 'app-test',
      diagnostics: [],
      generatedAt: '2026-07-06T00:00:00.000Z',
      graph: {
        edges: [],
        nodes: [
          { id: 'route-node:first', kind: 'route', label: 'GET /users' },
          { id: 'route-node:second', kind: 'route', label: 'GET /users' },
        ],
      },
      requests: [],
      routes: [
        {
          controller: 'Users Controller',
          graphNodeId: 'route-node:first',
          handler: 'list',
          id: 'GET /users Users Controller list',
          kind: 'react-page',
          method: 'GET',
          params: [],
          path: '/users',
        },
        {
          controller: 'Users_Controller',
          graphNodeId: 'route-node:second',
          handler: 'list',
          id: 'GET /users Users_Controller list',
          kind: 'http',
          method: 'GET',
          params: [],
          path: '/users',
        },
      ],
      version: 1,
    });
    const container = document.createElement('div');
    const root = createRoot(container);
    root.render(createElement(RoutesPanel, { dispatch, state }));
    await vi.waitFor(() => {
      expect(container.querySelectorAll('.route-row')).toHaveLength(2);
    });

    try {
      // When
      container.querySelectorAll<HTMLButtonElement>('.route-row')[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Then
      expect(dispatch).toHaveBeenCalledWith({ routeId: 'GET /users Users_Controller list', type: 'select-route' });
      expect(dispatch).toHaveBeenCalledWith({ nodeId: 'route-node:second', type: 'select-graph-node' });
    } finally {
      root.unmount();
    }
  });

  it('shows React page diagnostics from static inspect snapshots', async () => {
    const state = staticState({
      components: [],
      diagnostics: [],
      generatedAt: '2026-07-28T00:00:00.000Z',
      health: { status: 'healthy' },
      readiness: { critical: false, status: 'ready' },
      routes: [
        {
          controller: 'ProductRouter',
          handler: 'show',
          id: 'GET /products/:productId ProductRouter show',
          kind: 'react-page',
          method: 'GET',
          params: ['productId'],
          path: '/products/:productId',
        },
      ],
    });
    const container = document.createElement('div');
    const root = createRoot(container);
    root.render(createElement(RoutesPanel, { dispatch: vi.fn(), state }));

    try {
      await vi.waitFor(() => {
        expect(container.querySelectorAll('.route-row')).toHaveLength(1);
      });
      expect(container.textContent).toContain('React page');
      expect(container.textContent).toContain('params: productId');
    } finally {
      root.unmount();
    }
  });

  it('normalizes legacy route descriptors before rendering route details', async () => {
    const state = staticState({
      components: [],
      diagnostics: [],
      generatedAt: '2026-07-28T00:00:00.000Z',
      health: { status: 'healthy' },
      readiness: { critical: false, status: 'ready' },
      routes: [
        {
          controller: 'LegacyController',
          handler: 'list',
          id: 'GET /legacy LegacyController list',
          method: 'GET',
          path: '/legacy',
        },
      ],
    });
    const container = document.createElement('div');
    const root = createRoot(container);
    root.render(createElement(RoutesPanel, { dispatch: vi.fn(), state }));

    try {
      await vi.waitFor(() => {
        expect(container.querySelectorAll('.route-row')).toHaveLength(1);
      });
      expect(container.textContent).toContain('HTTP handler');
      expect(container.textContent).not.toContain('params:');
    } finally {
      root.unmount();
    }
  });
});
