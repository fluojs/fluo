import type { IncomingMessage } from 'node:http';

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as bun from './bun.js';
import * as workers from './cloudflare-workers.js';
import * as deno from './deno.js';
import * as websockets from './index.js';
import * as node from './node.js';
import type { WebSocketModuleOptions as BunWebSocketModuleOptions } from './bun.js';
import type { WebSocketModuleOptions as CloudflareWorkersWebSocketModuleOptions } from './cloudflare-workers.js';
import type { WebSocketModuleOptions as DenoWebSocketModuleOptions } from './deno.js';
import type { WebSocketModuleOptions as NodeWebSocketModuleOptions } from './node.js';
import type { WebSocketModuleOptions as RootWebSocketModuleOptions } from './index.js';

type UpgradeGuardRequest<TOptions> = TOptions extends { upgrade?: { guard?: (request: infer TRequest, ...args: never[]) => unknown } }
  ? TRequest
  : never;

describe('@fluojs/websockets public surface', () => {
  it('keeps the documented root barrel focused on module-first registration', () => {
    expect(websockets).toHaveProperty('WebSocketModule');
    expect((websockets as { WebSocketModule: { forRoot: unknown } }).WebSocketModule).toHaveProperty('forRoot');
    expect(websockets).toHaveProperty('WebSocketGatewayLifecycleService');
    expect(websockets).not.toHaveProperty('createWebSocketProviders');
    expect(websockets).not.toHaveProperty('WEBSOCKET_OPTIONS_INTERNAL');
    expect(websockets).toHaveProperty('WebSocketGateway');
    expect(websockets).toHaveProperty('OnConnect');
    expect(websockets).toHaveProperty('OnDisconnect');
    expect(websockets).toHaveProperty('OnMessage');
    expect(Object.keys(websockets).sort()).toMatchSnapshot('root');
  });

  it('keeps runtime subpaths focused on explicit module and lifecycle exports', () => {
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

    expect({
      bun: Object.keys(bun).sort(),
      'cloudflare-workers': Object.keys(workers).sort(),
      deno: Object.keys(deno).sort(),
      node: Object.keys(node).sort(),
    }).toMatchSnapshot('runtime-subpaths');
  });

  it('exposes gateway authoring primitives from every runtime subpath', () => {
    const runtimeSubpaths = [bun, deno, node, workers];

    for (const runtimeSubpath of runtimeSubpaths) {
      expect(runtimeSubpath).toHaveProperty('WebSocketGateway');
      expect(runtimeSubpath).toHaveProperty('OnConnect');
      expect(runtimeSubpath).toHaveProperty('OnDisconnect');
      expect(runtimeSubpath).toHaveProperty('OnMessage');
      expect(runtimeSubpath).toHaveProperty('defineWebSocketGatewayMetadata');
      expect(runtimeSubpath).toHaveProperty('getWebSocketGatewayMetadata');
      expect(runtimeSubpath).toHaveProperty('defineWebSocketHandlerMetadata');
      expect(runtimeSubpath).toHaveProperty('getWebSocketHandlerMetadata');
      expect(runtimeSubpath).toHaveProperty('getWebSocketHandlerMetadataEntries');
      expect(runtimeSubpath).toHaveProperty('webSocketGatewayMetadataSymbol');
      expect(runtimeSubpath).toHaveProperty('webSocketHandlerMetadataSymbol');
    }
  });

  it('keeps fetch-style runtime upgrade guards scoped to Request inputs', () => {
    expectTypeOf<UpgradeGuardRequest<RootWebSocketModuleOptions>>().toEqualTypeOf<IncomingMessage>();
    expectTypeOf<UpgradeGuardRequest<BunWebSocketModuleOptions>>().toEqualTypeOf<Request>();
    expectTypeOf<UpgradeGuardRequest<DenoWebSocketModuleOptions>>().toEqualTypeOf<Request>();
    expectTypeOf<UpgradeGuardRequest<CloudflareWorkersWebSocketModuleOptions>>().toEqualTypeOf<Request>();
    expectTypeOf<UpgradeGuardRequest<NodeWebSocketModuleOptions>>().toEqualTypeOf<IncomingMessage>();
  });
});
