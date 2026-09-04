// @vitest-environment happy-dom

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import { initialStudioState } from '../../../entities/studio/model.js';
import { RoutesPanel } from './RoutesPanel.js';

describe('RoutesPanel', () => {
  it('renders custom route kinds distinctly while retaining built-in labels', async () => {
    const state: StudioDashboardState = {
      ...initialStudioState,
      liveSnapshot: {
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
      },
      mode: 'live',
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
    const state: StudioDashboardState = {
      ...initialStudioState,
      liveSnapshot: {
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
      },
      mode: 'live',
    };
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
    const state: StudioDashboardState = {
      ...initialStudioState,
      staticReport: {
        payload: {
          snapshot: {
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
          },
        },
      },
    };
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
    const state: StudioDashboardState = {
      ...initialStudioState,
      staticReport: {
        payload: {
          snapshot: {
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
          },
        },
      },
    };
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
