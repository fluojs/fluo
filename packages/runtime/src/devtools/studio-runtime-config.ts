import type { StudioLiveEventSource } from './contracts.js';

/**
 * Describes Studio Devtools Config data used by the Studio devtool.
 */
export interface StudioDevtoolsConfig {
  readonly FLUO_STUDIO?: string;
  readonly FLUO_STUDIO_APP_ID?: string;
  readonly FLUO_STUDIO_ENDPOINT?: string;
  readonly FLUO_STUDIO_EPOCH?: string;
  readonly FLUO_STUDIO_RUNTIME?: string;
  readonly FLUO_STUDIO_TOKEN?: string;
  readonly FLUO_STUDIO_URL?: string;
}

export interface StudioDevtoolsConfigSnapshot {
  readonly appId: string | undefined;
  readonly endpoint: string;
  readonly epoch: string | undefined;
  readonly runtime: StudioLiveEventSource['runtime'];
  readonly token: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __FLUO_STUDIO_DEVTOOLS_CONFIG__: StudioDevtoolsConfig | undefined;
}

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeRuntime(value: string | undefined): StudioLiveEventSource['runtime'] {
  if (value === 'node' || value === 'bun' || value === 'deno' || value === 'worker') {
    return value;
  }

  return 'node';
}

function resolveEndpoint(endpoint: string | undefined, studioUrl: string | undefined): string | undefined {
  try {
    const resolved = endpoint ? new URL(endpoint) : studioUrl ? new URL('/api/runtime/events', studioUrl) : undefined;
    if (!resolved || (resolved.protocol !== 'http:' && resolved.protocol !== 'https:')) {
      return undefined;
    }

    return resolved.toString();
  } catch {
    return undefined;
  }
}

export function captureStudioDevtoolsConfig(config: StudioDevtoolsConfig | undefined): StudioDevtoolsConfigSnapshot | undefined {
  const value: unknown = config ?? globalThis.__FLUO_STUDIO_DEVTOOLS_CONFIG__;
  if (!isRecord(value)) {
    return undefined;
  }

  const {
    FLUO_STUDIO,
    FLUO_STUDIO_APP_ID,
    FLUO_STUDIO_ENDPOINT,
    FLUO_STUDIO_EPOCH,
    FLUO_STUDIO_RUNTIME,
    FLUO_STUDIO_TOKEN,
    FLUO_STUDIO_URL,
  } = value;
  if (
    !isOptionalString(FLUO_STUDIO)
    || !isOptionalString(FLUO_STUDIO_APP_ID)
    || !isOptionalString(FLUO_STUDIO_ENDPOINT)
    || !isOptionalString(FLUO_STUDIO_EPOCH)
    || !isOptionalString(FLUO_STUDIO_RUNTIME)
    || !isOptionalString(FLUO_STUDIO_TOKEN)
    || !isOptionalString(FLUO_STUDIO_URL)
  ) {
    return undefined;
  }

  const endpoint = resolveEndpoint(FLUO_STUDIO_ENDPOINT, FLUO_STUDIO_URL);
  if (!isEnabled(FLUO_STUDIO) || !endpoint || !FLUO_STUDIO_TOKEN) {
    return undefined;
  }

  return Object.freeze({
    appId: FLUO_STUDIO_APP_ID,
    endpoint,
    epoch: FLUO_STUDIO_EPOCH,
    runtime: normalizeRuntime(FLUO_STUDIO_RUNTIME),
    token: FLUO_STUDIO_TOKEN,
  });
}
