import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';

import { describe, expect, expectTypeOf, it } from 'vitest';
import type { WebSocketUpgradeGuard as BunWebSocketUpgradeGuard } from './bun.js';
import * as bun from './bun.js';
import type { WebSocketUpgradeGuard as CloudflareWorkersWebSocketUpgradeGuard } from './cloudflare-workers.js';
import * as workers from './cloudflare-workers.js';
import type { WebSocketUpgradeGuard as DenoWebSocketUpgradeGuard } from './deno.js';
import * as deno from './deno.js';
import type { WebSocketUpgradeGuard as RootWebSocketUpgradeGuard } from './index.js';
import * as websockets from './index.js';
import type { WebSocketUpgradeGuard as NodeWebSocketUpgradeGuard } from './node.js';
import * as node from './node.js';

type UpgradeGuardRequest<TGuard> = TGuard extends (...args: infer TArguments) => unknown
  ? TArguments[0]
  : never;

describe('@fluojs/websockets public surface', () => {
  it('declares the patched ws dependency floor', () => {
    const packageManifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    expect(packageManifest).toContain('"ws": "^8.21.0"');
  });

  it('keeps root package imports and declarations behind runtime-neutral source boundaries', () => {
    const rootEntrypoint = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

    expect(rootEntrypoint).not.toContain('./node.js');
    expect(rootEntrypoint).not.toContain('./node/');
    expect(rootEntrypoint).not.toContain("from './module.js'");
    expect(rootEntrypoint).not.toContain('WebSocketGatewayLifecycleService');
  });

  it('keeps the root barrel focused on runtime-neutral gateway authoring', () => {
    expect(websockets).not.toHaveProperty('WebSocketModule');
    expect(websockets).not.toHaveProperty('WebSocketGatewayLifecycleService');
    expect(websockets).not.toHaveProperty('createWebSocketProviders');
    expect(websockets).not.toHaveProperty('WEBSOCKET_OPTIONS_INTERNAL');
    expect(websockets).toHaveProperty('WebSocketGateway');
    expect(websockets).toHaveProperty('OnConnect');
    expect(websockets).toHaveProperty('OnDisconnect');
    expect(websockets).toHaveProperty('OnMessage');
  });

  it('keeps runtime subpaths focused on explicit module lifecycle and projection exports', () => {
    expect(node).toHaveProperty('NodeWebSocketModule');
    expect(node).toHaveProperty('NodeWebSocketGatewayLifecycleService');
    expect(node).not.toHaveProperty('createNodeWebSocketProviders');

    expect(bun).toHaveProperty('BunWebSocketModule');
    expect(bun).toHaveProperty('BunWebSocketGatewayLifecycleService');
    expect(bun).not.toHaveProperty('createBunWebSocketProviders');

    expect(deno).toHaveProperty('DenoWebSocketModule');
    expect(deno).toHaveProperty('DenoWebSocketGatewayLifecycleService');
    expect(deno).not.toHaveProperty('createDenoWebSocketProviders');

    expect(workers).toHaveProperty('CloudflareWorkersWebSocketModule');
    expect(workers).toHaveProperty('CloudflareWorkersWebSocketGatewayLifecycleService');
    expect(workers).not.toHaveProperty('createCloudflareWorkersWebSocketProviders');

    const runtimeSubpaths = [bun, deno, node, workers];

    for (const runtimeSubpath of runtimeSubpaths) {
      expect(runtimeSubpath).not.toHaveProperty('WebSocketGateway');
      expect(runtimeSubpath).not.toHaveProperty('OnConnect');
      expect(runtimeSubpath).not.toHaveProperty('OnDisconnect');
      expect(runtimeSubpath).not.toHaveProperty('OnMessage');
      expect(runtimeSubpath).not.toHaveProperty('defineWebSocketGatewayMetadata');
      expect(runtimeSubpath).not.toHaveProperty('getWebSocketGatewayMetadata');
      expect(runtimeSubpath).not.toHaveProperty('defineWebSocketHandlerMetadata');
      expect(runtimeSubpath).not.toHaveProperty('getWebSocketHandlerMetadata');
      expect(runtimeSubpath).not.toHaveProperty('getWebSocketHandlerMetadataEntries');
      expect(runtimeSubpath).not.toHaveProperty('webSocketGatewayMetadataSymbol');
      expect(runtimeSubpath).not.toHaveProperty('webSocketHandlerMetadataSymbol');
    }
  });

  it('keeps root gateway authoring types and fetch-style guards scoped to runtime-neutral Request inputs', () => {
    expectTypeOf<UpgradeGuardRequest<RootWebSocketUpgradeGuard>>().toEqualTypeOf<Request>();
    expectTypeOf<UpgradeGuardRequest<BunWebSocketUpgradeGuard>>().toEqualTypeOf<Request>();
    expectTypeOf<UpgradeGuardRequest<DenoWebSocketUpgradeGuard>>().toEqualTypeOf<Request>();
    expectTypeOf<UpgradeGuardRequest<CloudflareWorkersWebSocketUpgradeGuard>>().toEqualTypeOf<Request>();
    expectTypeOf<UpgradeGuardRequest<NodeWebSocketUpgradeGuard>>().toEqualTypeOf<IncomingMessage>();
  });
});
