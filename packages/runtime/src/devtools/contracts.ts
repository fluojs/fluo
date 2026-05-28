import type { BootstrapTimingDiagnostics } from '../health/diagnostics.js';

/**
 * Defines Studio Graph Node Kind values used by the Studio devtool.
 */
export type StudioGraphNodeKind = 'module' | 'provider' | 'controller' | 'route' | 'platform' | 'external';
/**
 * Defines Studio Graph Edge Kind values used by the Studio devtool.
 */
export type StudioGraphEdgeKind = 'imports' | 'owns_provider' | 'owns_controller' | 'exposes_route' | 'depends_on' | 'exports';

/**
 * Describes Studio Graph Node data used by the Studio devtool.
 */
export interface StudioGraphNode {
  id: string;
  kind: StudioGraphNodeKind;
  label: string;
  metadata?: Record<string, unknown>;
  status?: 'active' | 'idle' | 'warning' | 'error';
}

/**
 * Describes Studio Graph Edge data used by the Studio devtool.
 */
export interface StudioGraphEdge {
  from: string;
  id: string;
  kind: StudioGraphEdgeKind;
  label?: string;
  metadata?: Record<string, unknown>;
  to: string;
}

/**
 * Describes Studio Route Descriptor data used by the Studio devtool.
 */
export interface StudioRouteDescriptor {
  controller: string;
  handler: string;
  id: string;
  method: string;
  module?: string;
  path: string;
  version?: string;
}

/**
 * Defines Studio Request Status values used by the Studio devtool.
 */
export type StudioRequestStatus = 'started' | 'matched' | 'succeeded' | 'failed' | 'finished';

/**
 * Describes Studio Request Trace data used by the Studio devtool.
 */
export interface StudioRequestTrace {
  controller?: string;
  durationMs?: number;
  error?: {
    message: string;
    name?: string;
  };
  finishedAt?: string;
  handler?: string;
  method: string;
  path: string;
  requestId: string;
  routeId?: string;
  startedAt: string;
  status: StudioRequestStatus;
  statusCode?: number;
  url: string;
}

/**
 * Describes Studio Live Diagnostic data used by the Studio devtool.
 */
export interface StudioLiveDiagnostic {
  code: string;
  fixHint?: string;
  message: string;
  scope?: string;
  severity: 'error' | 'warning' | 'info';
  targetId?: string;
}

/**
 * Describes Studio Live Snapshot data used by the Studio devtool.
 */
export interface StudioLiveSnapshot {
  appId: string;
  diagnostics: StudioLiveDiagnostic[];
  generatedAt: string;
  graph: {
    edges: StudioGraphEdge[];
    nodes: StudioGraphNode[];
  };
  requests: StudioRequestTrace[];
  routes: StudioRouteDescriptor[];
  timing?: BootstrapTimingDiagnostics;
  version: 1;
}

/**
 * Describes Studio Live Event Source data used by the Studio devtool.
 */
export interface StudioLiveEventSource {
  appId: string;
  runtime: 'node' | 'bun' | 'deno' | 'worker' | 'unknown';
}

/**
 * Describes Studio Live Event Base data used by the Studio devtool.
 */
export interface StudioLiveEventBase<TType extends string, TPayload> {
  emittedAt: string;
  epoch: string;
  eventId: string;
  payload: TPayload;
  sequence: number;
  source: StudioLiveEventSource;
  type: TType;
  version: 1;
}

/**
 * Defines Studio Heartbeat Payload values used by the Studio devtool.
 */
export type StudioHeartbeatPayload = {
  uptimeMs?: number;
};

/**
 * Describes Studio Restart Payload data used by the Studio devtool.
 */
export interface StudioRestartPayload {
  phase: 'scheduled' | 'starting' | 'started' | 'stopping' | 'stopped';
  reason?: string;
}

/**
 * Describes Studio Disconnect Payload data used by the Studio devtool.
 */
export interface StudioDisconnectPayload {
  reason?: string;
}

/**
 * Defines Studio Live Event values used by the Studio devtool.
 */
export type StudioLiveEvent =
  | StudioLiveEventBase<'disconnect', StudioDisconnectPayload>
  | StudioLiveEventBase<'diagnostic', StudioLiveDiagnostic>
  | StudioLiveEventBase<'heartbeat', StudioHeartbeatPayload>
  | StudioLiveEventBase<'request', StudioRequestTrace>
  | StudioLiveEventBase<'restart', StudioRestartPayload>
  | StudioLiveEventBase<'snapshot', StudioLiveSnapshot>
  | StudioLiveEventBase<'timing', BootstrapTimingDiagnostics>;
