export const STUDIO_DEVTOOLS_GLOBAL_CONFIG_KEY = '__FLUO_STUDIO_DEVTOOLS_CONFIG__';

export interface StudioDevtoolsInjectedConfig {
  FLUO_STUDIO: '1';
  FLUO_STUDIO_APP_ID?: string;
  FLUO_STUDIO_ENDPOINT?: string;
  FLUO_STUDIO_EPOCH?: string;
  FLUO_STUDIO_RUNTIME?: string;
  FLUO_STUDIO_TOKEN: string;
  FLUO_STUDIO_URL?: string;
}

function isEnabledEnvironmentFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function resolveStudioIngestEndpoint(env: NodeJS.ProcessEnv): string | undefined {
  if (env.FLUO_STUDIO_ENDPOINT) {
    return env.FLUO_STUDIO_ENDPOINT;
  }

  if (!env.FLUO_STUDIO_URL) {
    return undefined;
  }

  try {
    return new URL('/api/runtime/events', env.FLUO_STUDIO_URL).toString();
  } catch {
    return undefined;
  }
}

/**
 * Builds the explicit Studio config that CLI-owned dev boundaries inject into app children.
 *
 * Package runtime code must not read ambient environment state directly. The CLI sidecar still stores the
 * generated app id/token/URL in child environment for process supervision, then this helper converts
 * those values into a typed process-local config object before the app imports `@fluojs/runtime`.
 */
export function resolveStudioDevtoolsInjectedConfig(env: NodeJS.ProcessEnv): StudioDevtoolsInjectedConfig | undefined {
  if (!isEnabledEnvironmentFlag(env.FLUO_STUDIO) || !env.FLUO_STUDIO_TOKEN) {
    return undefined;
  }

  const endpoint = resolveStudioIngestEndpoint(env);
  if (!endpoint) {
    return undefined;
  }

  return {
    FLUO_STUDIO: '1',
    FLUO_STUDIO_APP_ID: env.FLUO_STUDIO_APP_ID,
    FLUO_STUDIO_ENDPOINT: endpoint,
    FLUO_STUDIO_EPOCH: env.FLUO_STUDIO_EPOCH,
    FLUO_STUDIO_RUNTIME: env.FLUO_STUDIO_RUNTIME,
    FLUO_STUDIO_TOKEN: env.FLUO_STUDIO_TOKEN,
    FLUO_STUDIO_URL: env.FLUO_STUDIO_URL,
  };
}

export function createStudioDevtoolsNodeImport(env: NodeJS.ProcessEnv): string[] {
  const config = resolveStudioDevtoolsInjectedConfig(env);

  if (!config) {
    return [];
  }

  const source = `Object.defineProperty(globalThis, ${JSON.stringify(STUDIO_DEVTOOLS_GLOBAL_CONFIG_KEY)}, { configurable: true, enumerable: false, writable: true, value: ${JSON.stringify(config)} });`;
  return ['--import', `data:text/javascript,${encodeURIComponent(source)}`];
}
