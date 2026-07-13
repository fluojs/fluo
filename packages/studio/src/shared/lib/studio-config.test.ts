// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { resolveStudioSidecarConfig } from './studio-config.js';

describe('resolveStudioSidecarConfig', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    delete window.__FLUO_STUDIO__;
  });

  it('derives encoded state and event URLs from the viewer query token', () => {
    const token = 'studio token+/=?&';
    const search = new URLSearchParams({ token });
    window.history.replaceState({}, '', `/?${search.toString()}`);

    const config = resolveStudioSidecarConfig();
    const encodedToken = encodeURIComponent(token);

    expect(config).toEqual({
      eventsUrl: `/api/events?token=${encodedToken}`,
      stateUrl: `/api/state?token=${encodedToken}`,
    });
  });
});
