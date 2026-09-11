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

/** Classifies a node in the runtime-neutral Studio application graph. */
export type StudioGraphNodeKind = 'module' | 'provider' | 'controller' | 'route' | 'platform' | 'external';

/** Classifies a relationship between two nodes in the Studio application graph. */
export type StudioGraphEdgeKind = 'imports' | 'owns_provider' | 'owns_controller' | 'exposes_route' | 'depends_on' | 'exports';

/** Describes one runtime-neutral node rendered by Studio's application graph. */
export interface StudioGraphNode {
  id: string;
  kind: StudioGraphNodeKind;
  label: string;
  metadata?: Record<string, unknown>;
  status?: 'active' | 'idle' | 'warning' | 'error';
}

/** Describes one directed relationship rendered by Studio's application graph. */
export interface StudioGraphEdge {
  from: string;
  id: string;
  kind: StudioGraphEdgeKind;
  label?: string;
  metadata?: Record<string, unknown>;
  to: string;
}

/** Identifies the framework-specific kind assigned to a discovered route. */
export type StudioRouteKind = string;

/** Carries a route descriptor in the wire shape emitted by a runtime. */
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

/** Carries a route descriptor after Studio fills wire-optional fields with normalized values. */
export interface StudioNormalizedRouteDescriptor extends Omit<StudioRouteDescriptor, 'graphNodeId' | 'kind' | 'params'> {
  graphNodeId: string;
  kind: StudioRouteKind;
  params: string[];
}

/** Tracks the lifecycle state of a request observed by Studio. */
export type StudioRequestStatus = 'started' | 'matched' | 'succeeded' | 'failed' | 'finished';

/** Records request lifecycle data exchanged between a runtime and Studio. */
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

/** Reports one runtime diagnostic available to Studio clients. */
export interface StudioLiveDiagnostic {
  code: string;
  fixHint?: string;
  message: string;
  scope?: string;
  severity: 'error' | 'warning' | 'info';
  targetId?: string;
}

/** Represents the complete wire snapshot emitted by a Studio-enabled runtime. */
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

/** Represents a live snapshot after its route descriptors are normalized for Studio consumers. */
export interface StudioParsedLiveSnapshot extends Omit<StudioLiveSnapshot, 'routes'> {
  routes: StudioNormalizedRouteDescriptor[];
}

/** Identifies the runtime-neutral source that emitted a Studio live event. */
export interface StudioLiveEventSource {
  appId: string;
  runtime: 'node' | 'bun' | 'deno' | 'worker' | 'unknown';
}

/** Defines the shared wire envelope for a typed Studio live event. */
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

/** Carries optional runtime uptime information in a heartbeat event. */
export type StudioHeartbeatPayload = {
  uptimeMs?: number;
};

/** Carries a runtime restart phase and optional reason. */
export interface StudioRestartPayload {
  phase: 'scheduled' | 'starting' | 'started' | 'stopping' | 'stopped';
  reason?: string;
}

/** Carries an optional reason for a runtime disconnect event. */
export interface StudioDisconnectPayload {
  reason?: string;
}

/** Unites every wire event emitted by a Studio-enabled runtime. */
export type StudioLiveEvent =
  | StudioLiveEventBase<'disconnect', StudioDisconnectPayload>
  | StudioLiveEventBase<'diagnostic', StudioLiveDiagnostic>
  | StudioLiveEventBase<'heartbeat', StudioHeartbeatPayload>
  | StudioLiveEventBase<'request', StudioRequestTrace>
  | StudioLiveEventBase<'restart', StudioRestartPayload>
  | StudioLiveEventBase<'snapshot', StudioLiveSnapshot>
  | StudioLiveEventBase<'timing', BootstrapTimingDiagnostics>;

/** Unites Studio live events after embedded snapshot routes are normalized. */
export type StudioParsedLiveEvent =
  | StudioLiveEventBase<'disconnect', StudioDisconnectPayload>
  | StudioLiveEventBase<'diagnostic', StudioLiveDiagnostic>
  | StudioLiveEventBase<'heartbeat', StudioHeartbeatPayload>
  | StudioLiveEventBase<'request', StudioRequestTrace>
  | StudioLiveEventBase<'restart', StudioRestartPayload>
  | StudioLiveEventBase<'snapshot', StudioParsedLiveSnapshot>
  | StudioLiveEventBase<'timing', BootstrapTimingDiagnostics>;
