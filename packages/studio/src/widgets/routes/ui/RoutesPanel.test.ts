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
            method: 'GET',
            path: '/users',
          },
          {
            controller: 'UsersController',
            handler: 'listV2',
            id: 'GET /users UsersController listV2',
            method: 'GET',
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
      container.querySelectorAll<HTMLButtonElement>('.route-row')[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(dispatch).toHaveBeenCalledWith({ routeId: 'GET /users UsersController listV2', type: 'select-route' });
      expect(dispatch).toHaveBeenCalledWith({ nodeId: 'route:GET__users_UsersController_listV2', type: 'select-graph-node' });
    } finally {
      root.unmount();
    }
  });
});
