import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, relative, sep } from 'node:path';
import { URL } from 'node:url';

/**
 * Defines Studio Sidecar Runtime values used by the Studio devtool.
 */
export type StudioSidecarRuntime = 'bun' | 'deno' | 'node' | 'unknown';

/**
 * Describes Studio Sidecar Options data used by the Studio devtool.
 */
export interface StudioSidecarOptions {
  appId?: string;
  heartbeatMs?: number;
  host?: string;
  port?: number;
  runtime?: StudioSidecarRuntime;
}

/**
 * Describes Studio Sidecar data used by the Studio devtool.
 */
export interface StudioSidecar {
  readonly appId: string;
  readonly epoch: string;
  readonly env: NodeJS.ProcessEnv;
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly url: string;
  close(): Promise<void>;
}

type JsonRecord = Record<string, unknown>;
type StoredStudioEvent = {
  emittedAt: string;
  epoch: string;
  eventId: string;
  payload: unknown;
  sequence: number;
  source: {
    appId: string;
    runtime: StudioSidecarRuntime;
  };
  type: string;
  version: 1;
};

type StudioClient = {
  response: ServerResponse;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_HEARTBEAT_MS = 15_000;
const MAX_EVENT_REPLAY = 1_000;
const MAX_REQUEST_BYTES = 1_048_576;
const require = createRequire(import.meta.url);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function isRestartEpochBoundary(incoming: { payload?: unknown; type?: unknown }): boolean {
  if (incoming.type !== 'restart' || !isRecord(incoming.payload)) {
    return false;
  }

  return incoming.payload.phase === 'scheduled' || incoming.payload.phase === 'starting';
}

function resolveRestartEpoch(incoming: { payload?: unknown; type?: unknown }): string | undefined {
  if (!isRestartEpochBoundary(incoming)) {
    return undefined;
  }

  const payload = isRecord(incoming.payload) ? incoming.payload : undefined;
  const requestedEpoch = payload?.epoch;

  return typeof requestedEpoch === 'string' && requestedEpoch.length > 0 ? requestedEpoch : createEpoch();
}

function createStudioSidecarEnv(options: { appId: string; epoch: string; runtime: StudioSidecarRuntime; token: string; url: string }): NodeJS.ProcessEnv {
  return {
    FLUO_STUDIO: '1',
    FLUO_STUDIO_APP_ID: options.appId,
    FLUO_STUDIO_EPOCH: options.epoch,
    FLUO_STUDIO_RUNTIME: options.runtime,
    FLUO_STUDIO_TOKEN: options.token,
    FLUO_STUDIO_URL: options.url,
  };
}

function createToken(): string {
  return randomBytes(24).toString('base64url');
}

function createEpoch(): string {
  return randomUUID();
}

function createDefaultAppId(): string {
  return `fluo-app-${process.pid}`;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_REQUEST_BYTES) {
        reject(new Error('Studio event payload is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function writeText(response: ServerResponse, statusCode: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': contentType,
  });
  response.end(body);
}

function contentTypeForPath(pathname: string): string {
  switch (extname(pathname)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.map':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function resolveStudioViewerPath(): string | undefined {
  try {
    const viewerPath = require.resolve('@fluojs/studio/viewer');
    return existsSync(viewerPath) ? viewerPath : undefined;
  } catch {
    return undefined;
  }
}

function injectStudioConfig(html: string, options: { eventsUrl: string; stateUrl: string }): string {
  const configScript = `<script>window.__FLUO_STUDIO__ = ${JSON.stringify(options).replaceAll('<', '\\u003c')};</script>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `  ${configScript}\n</head>`);
  }

  return `${configScript}\n${html}`;
}

function safeAssetPath(rootDirectory: string, pathname: string): string | undefined {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const normalized = normalize(decodedPath).replace(/^[/\\]+/, '');
  const candidate = join(rootDirectory, normalized);
  const relativePath = relative(rootDirectory, candidate);
  if (relativePath.startsWith('..') || relativePath.split(sep).includes('..')) {
    return undefined;
  }

  return candidate;
}

function serveStudioAsset(response: ServerResponse, rootDirectory: string, pathname: string): boolean {
  const assetPath = safeAssetPath(rootDirectory, pathname);
  if (!assetPath || !existsSync(assetPath)) {
    return false;
  }

  const stats = statSync(assetPath);
  if (!stats.isFile()) {
    return false;
  }

  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-length': String(stats.size),
    'content-type': contentTypeForPath(assetPath),
  });
  createReadStream(assetPath).pipe(response);
  return true;
}

function extractBearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;

  if (typeof authorization !== 'string') {
    return undefined;
  }

  const [scheme, token] = authorization.split(' ');
  return scheme.toLowerCase() === 'bearer' && token ? token : undefined;
}

function requestToken(request: IncomingMessage, url: URL): string | undefined {
  return extractBearerToken(request) ?? url.searchParams.get('token') ?? undefined;
}

function isAuthorized(request: IncomingMessage, url: URL, token: string): boolean {
  return requestToken(request, url) === token;
}

function parseAfterSequence(url: URL, request: IncomingMessage, epoch: string): number {
  const after = url.searchParams.get('after') ?? request.headers['last-event-id'];
  const value = Array.isArray(after) ? after[0] : after;

  if (!value) {
    return 0;
  }

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  const [eventEpoch, sequence] = value.split(':');
  if (eventEpoch === epoch && /^\d+$/.test(sequence)) {
    return Number(sequence);
  }

  return 0;
}

function writeSseEvent(response: ServerResponse, event: StoredStudioEvent): void {
  response.write(`id: ${event.eventId}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function renderStudioShell(options: { eventsUrl: string; stateUrl: string }): string {
  const viewerPath = resolveStudioViewerPath();
  if (viewerPath) {
    return injectStudioConfig(readFileSync(viewerPath, 'utf8'), options);
  }

  const config = JSON.stringify(options).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fluo Studio</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #0a0f1d; color: #dbeafe; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 32px; }
    section { max-width: 760px; border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 24px; padding: 32px; background: linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.82)); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28); }
    h1 { margin: 0 0 12px; font-size: 34px; letter-spacing: -0.04em; }
    p { color: #94a3b8; line-height: 1.7; }
    code { color: #93c5fd; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Fluo Studio sidecar is live</h1>
      <p>This token-protected local sidecar is receiving runtime events. The React Studio UI will attach to <code>/api/events</code> in the next package layer.</p>
      <p>Config: <code id="config"></code></p>
    </section>
  </main>
  <script>window.__FLUO_STUDIO__ = ${config}; document.getElementById('config').textContent = JSON.stringify(window.__FLUO_STUDIO__);</script>
</body>
</html>`;
}

/**
 * Provides start Studio Sidecar behavior for the Studio devtool.
 *
 * @param options options value used by start Studio Sidecar.
 * @returns The start Studio Sidecar result.
 */
export async function startStudioSidecar(options: StudioSidecarOptions = {}): Promise<StudioSidecar> {
  const host = options.host ?? DEFAULT_HOST;
  const appId = options.appId ?? createDefaultAppId();
  const runtime = options.runtime ?? 'node';
  let epoch = createEpoch();
  const token = createToken();
  const events: StoredStudioEvent[] = [];
  const clients = new Set<StudioClient>();
  let sequence = 0;
  const startedAt = performance.now();

  const publish = (incoming: { payload?: unknown; source?: unknown; type?: unknown }): StoredStudioEvent => {
    const restartEpoch = resolveRestartEpoch(incoming);
    if (restartEpoch) {
      epoch = restartEpoch;
    }

    sequence += 1;
    const source = isRecord(incoming.source) ? incoming.source : undefined;
    const sourceAppId = typeof source?.appId === 'string' && source.appId.length > 0 ? source.appId : appId;
    const sourceRuntime = source?.runtime === 'bun' || source?.runtime === 'deno' || source?.runtime === 'node' ? source.runtime : runtime;
    const event: StoredStudioEvent = {
      emittedAt: new Date().toISOString(),
      epoch,
      eventId: `${epoch}:${String(sequence)}`,
      payload: incoming.payload ?? {},
      sequence,
      source: {
        appId: sourceAppId,
        runtime: sourceRuntime,
      },
      type: typeof incoming.type === 'string' && incoming.type.length > 0 ? incoming.type : 'diagnostic',
      version: 1,
    };

    events.push(event);
    if (events.length > MAX_EVENT_REPLAY) {
      events.splice(0, events.length - MAX_EVENT_REPLAY);
    }

    for (const client of clients) {
      writeSseEvent(client.response, event);
    }

    return event;
  };

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${host}`);
    const viewerPath = resolveStudioViewerPath();

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/assets/') && viewerPath) {
      if (serveStudioAsset(response, dirname(viewerPath), requestUrl.pathname)) {
        return;
      }
    }

    if (!isAuthorized(request, requestUrl, token)) {
      writeJson(response, 401, { error: 'Unauthorized Studio sidecar request.' });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/') {
      const tokenQuery = encodeURIComponent(token);
      writeText(response, 200, renderStudioShell({
        eventsUrl: `/api/events?token=${tokenQuery}`,
        stateUrl: `/api/state?token=${tokenQuery}`,
      }), 'text/html; charset=utf-8');
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/state') {
      writeJson(response, 200, {
        appId,
        clientCount: clients.size,
        epoch,
        events,
        sequence,
      });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/events') {
      response.writeHead(200, {
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
      });
      response.write(': fluo studio stream ready\n\n');

      const afterSequence = requestUrl.searchParams.get('replay') === '0' ? sequence : parseAfterSequence(requestUrl, request, epoch);
      for (const event of events) {
        if (event.sequence > afterSequence) {
          writeSseEvent(response, event);
        }
      }

      const client = { response };
      clients.add(client);
      request.on('close', () => {
        clients.delete(client);
      });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/runtime/events') {
      try {
        const body = await readBody(request);
        const parsed = body ? JSON.parse(body) as unknown : {};
        if (!isRecord(parsed)) {
          writeJson(response, 400, { error: 'Studio runtime event must be a JSON object.' });
          return;
        }

        const event = publish(parsed);
        writeJson(response, 202, {
          accepted: true,
          epoch: event.epoch,
          sequence: event.sequence,
        });
      } catch (error) {
        writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    writeJson(response, 404, { error: 'Unknown Studio sidecar route.' });
  });

  const heartbeat = options.heartbeatMs === 0
    ? undefined
    : setInterval(() => {
        publish({
          payload: { uptimeMs: Number((performance.now() - startedAt).toFixed(3)) },
          source: { appId, runtime },
          type: 'heartbeat',
        });
      }, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  heartbeat?.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server, clients, heartbeat);
    throw new Error('Failed to resolve Studio sidecar address.');
  }

  const url = `http://${host}:${String(address.port)}`;

  return {
    appId,
    get epoch() {
      return epoch;
    },
    get env() {
      return createStudioSidecarEnv({
        appId,
        epoch,
        runtime,
        token,
        url,
      });
    },
    host,
    port: address.port,
    token,
    url,
    async close() {
      await closeServer(server, clients, heartbeat);
    },
  };
}

async function closeServer(server: Server, clients: Set<StudioClient>, heartbeat: NodeJS.Timeout | undefined): Promise<void> {
  if (heartbeat) {
    clearInterval(heartbeat);
  }

  for (const client of clients) {
    client.response.end();
  }
  clients.clear();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
