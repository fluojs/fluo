/** One bootstrap timing phase represented in a Studio artifact. */
export interface BootstrapTimingPhase {
  durationMs: number;
  name:
    | 'bootstrap_module'
    | 'register_runtime_tokens'
    | 'resolve_lifecycle_instances'
    | 'run_bootstrap_lifecycle'
    | 'create_dispatcher';
}

/** Bootstrap timing diagnostics exchanged by Studio and Runtime. */
export interface BootstrapTimingDiagnostics {
  phases: BootstrapTimingPhase[];
  totalMs: number;
  version: 1;
}

export type StudioGraphNodeKind = 'module' | 'provider' | 'controller' | 'route' | 'platform' | 'external';
export type StudioGraphEdgeKind = 'imports' | 'owns_provider' | 'owns_controller' | 'exposes_route' | 'depends_on' | 'exports';

export interface StudioGraphNode {
  id: string;
  kind: StudioGraphNodeKind;
  label: string;
  metadata?: Record<string, unknown>;
  status?: 'active' | 'idle' | 'warning' | 'error';
}

export interface StudioGraphEdge {
  from: string;
  id: string;
  kind: StudioGraphEdgeKind;
  label?: string;
  metadata?: Record<string, unknown>;
  to: string;
}

export type StudioRouteKind = string;

export interface StudioRouteDescriptor {
  controller: string;
  graphNodeId?: string;
  handler: string;
  id: string;
  kind?: StudioRouteKind;
  method: string;
  module?: string;
  params?: string[];
  path: string;
  version?: string;
}

export interface StudioNormalizedRouteDescriptor extends Omit<StudioRouteDescriptor, 'graphNodeId' | 'kind' | 'params'> {
  graphNodeId: string;
  kind: StudioRouteKind;
  params: string[];
}

export type StudioRequestStatus = 'started' | 'matched' | 'succeeded' | 'failed' | 'finished';

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

export interface StudioLiveDiagnostic {
  code: string;
  fixHint?: string;
  message: string;
  scope?: string;
  severity: 'error' | 'warning' | 'info';
  targetId?: string;
}

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

export interface StudioParsedLiveSnapshot extends Omit<StudioLiveSnapshot, 'routes'> {
  routes: StudioNormalizedRouteDescriptor[];
}

export interface StudioLiveEventSource {
  appId: string;
  runtime: 'node' | 'bun' | 'deno' | 'worker' | 'unknown';
}

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

export type StudioHeartbeatPayload = {
  uptimeMs?: number;
};

export interface StudioRestartPayload {
  phase: 'scheduled' | 'starting' | 'started' | 'stopping' | 'stopped';
  reason?: string;
}

export interface StudioDisconnectPayload {
  reason?: string;
}

export type StudioLiveEvent =
  | StudioLiveEventBase<'disconnect', StudioDisconnectPayload>
  | StudioLiveEventBase<'diagnostic', StudioLiveDiagnostic>
  | StudioLiveEventBase<'heartbeat', StudioHeartbeatPayload>
  | StudioLiveEventBase<'request', StudioRequestTrace>
  | StudioLiveEventBase<'restart', StudioRestartPayload>
  | StudioLiveEventBase<'snapshot', StudioLiveSnapshot>
  | StudioLiveEventBase<'timing', BootstrapTimingDiagnostics>;

export type StudioParsedLiveEvent =
  | StudioLiveEventBase<'disconnect', StudioDisconnectPayload>
  | StudioLiveEventBase<'diagnostic', StudioLiveDiagnostic>
  | StudioLiveEventBase<'heartbeat', StudioHeartbeatPayload>
  | StudioLiveEventBase<'request', StudioRequestTrace>
  | StudioLiveEventBase<'restart', StudioRestartPayload>
  | StudioLiveEventBase<'snapshot', StudioParsedLiveSnapshot>
  | StudioLiveEventBase<'timing', BootstrapTimingDiagnostics>;
