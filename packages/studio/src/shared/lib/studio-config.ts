/**
 * Describes Studio Sidecar Config data used by the Studio devtool.
 */
export interface StudioSidecarConfig {
  eventsUrl: string;
  stateUrl?: string;
}

declare global {
  interface Window {
    __FLUO_STUDIO__?: Partial<StudioSidecarConfig>;
  }
}

function normalizeInjectedUrl(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Provides resolve Studio Sidecar Config behavior for the Studio devtool.
 *
 * @param location location value used by resolve Studio Sidecar Config.
 * @returns The resolve Studio Sidecar Config result.
 */
export function resolveStudioSidecarConfig(location: Location = window.location): StudioSidecarConfig | undefined {
  const injected = window.__FLUO_STUDIO__;
  const injectedEventsUrl = normalizeInjectedUrl(injected?.eventsUrl);

  if (injectedEventsUrl) {
    return {
      eventsUrl: injectedEventsUrl,
      stateUrl: normalizeInjectedUrl(injected?.stateUrl),
    };
  }

  const token = new URLSearchParams(location.search).get('token');
  if (!token) {
    return undefined;
  }

  const encoded = encodeURIComponent(token);
  return {
    eventsUrl: `/api/events?token=${encoded}`,
    stateUrl: `/api/state?token=${encoded}`,
  };
}
