// @vitest-environment happy-dom

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { StudioDashboardState } from '../../../entities/studio/model.js';
import { initialStudioState } from '../../../entities/studio/model.js';
import { RoutesPanel } from './RoutesPanel.js';

describe('RoutesPanel', () => {
  it('selects graph route nodes by stable route id when labels collide', async () => {
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
            { id: 'route:GET__users_UsersController_list', kind: 'route', label: 'GET /users' },
            { id: 'route:GET__users_UsersController_listV2', kind: 'route', label: 'GET /users' },
          ],
        },
        requests: [],
        routes: [
          {
            controller: 'UsersController',
            handler: 'list',
            id: 'GET /users UsersController list',
            kind: 'react-page',
            method: 'GET',
            params: [],
            path: '/users',
          },
          {
            controller: 'UsersController',
            handler: 'listV2',
            id: 'GET /users UsersController listV2',
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

    try {
      await vi.waitFor(() => {
        expect(container.querySelectorAll('.route-row')).toHaveLength(2);
      });
      expect(container.textContent).toContain('React page');
      expect(container.textContent).toContain('HTTP handler');
      container.querySelectorAll<HTMLButtonElement>('.route-row')[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(dispatch).toHaveBeenCalledWith({ routeId: 'GET /users UsersController listV2', type: 'select-route' });
      expect(dispatch).toHaveBeenCalledWith({ nodeId: 'route:GET__users_UsersController_listV2', type: 'select-graph-node' });
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
});
