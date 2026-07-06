import type {
  BootstrapTimingDiagnostics,
  PlatformDiagnosticIssue,
  PlatformShellSnapshot,
  PlatformSnapshot,
} from '@fluojs/runtime';

export type { PlatformDiagnosticIssue, PlatformShellSnapshot } from '@fluojs/runtime';

/**
 * Readiness statuses supported by Studio snapshot filtering and graph annotations.
 */
export type PlatformReadinessStatus = PlatformSnapshot['readiness']['status'];

/**
 * Diagnostic severities supported by Studio snapshot filtering.
 */
export type PlatformDiagnosticSeverity = PlatformDiagnosticIssue['severity'];

/**
 * Stable summary emitted by `fluo inspect --report` for support and CI triage.
 */
export interface StudioReportSummary {
  componentCount: number;
  diagnosticCount: number;
  errorCount: number;
  healthStatus: PlatformShellSnapshot['health']['status'];
  readinessStatus: PlatformShellSnapshot['readiness']['status'];
  timingTotalMs: number;
  warningCount: number;
}

/**
 * CI-friendly report artifact emitted by `fluo inspect --report`.
 */
export interface StudioReportArtifact {
  generatedAt: string;
  snapshot: PlatformShellSnapshot;
  summary: StudioReportSummary;
  timing: BootstrapTimingDiagnostics;
  version: 1;
}

/**
 * Serializable Studio payload envelope built from inspect snapshot/timing exports.
 */
export interface StudioPayload {
  report?: StudioReportArtifact;
  snapshot?: PlatformShellSnapshot;
  timing?: BootstrapTimingDiagnostics;
}


/** Live Studio graph node kinds emitted by runtime-connected devtools. */
export type StudioGraphNodeKind = 'module' | 'provider' | 'controller' | 'route' | 'platform' | 'external';

/** Live Studio graph edge kinds emitted by runtime-connected devtools. */
export type StudioGraphEdgeKind = 'imports' | 'owns_provider' | 'owns_controller' | 'exposes_route' | 'depends_on' | 'exports';

/** Serializable node in the runtime-connected Studio dependency graph. */
export interface StudioGraphNode {
  id: string;
  kind: StudioGraphNodeKind;
  label: string;
  metadata?: Record<string, unknown>;
  status?: 'active' | 'idle' | 'warning' | 'error';
}

/** Serializable edge in the runtime-connected Studio dependency graph. */
export interface StudioGraphEdge {
  from: string;
  id: string;
  kind: StudioGraphEdgeKind;
  label?: string;
  metadata?: Record<string, unknown>;
  to: string;
}

/** Route descriptor projected into the live Studio UI. */
export interface StudioRouteDescriptor {
  controller: string;
  handler: string;
  id: string;
  method: string;
  module?: string;
  path: string;
  version?: string;
}

/** Request lifecycle status understood by the live Studio request-flow panel. */
export type StudioRequestStatus = 'started' | 'matched' | 'succeeded' | 'failed' | 'finished';

/** Request trace emitted by runtime observers without request/response bodies. */
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

/** Runtime diagnostic surfaced in the live Studio diagnostics panel. */
export interface StudioLiveDiagnostic {
  code: string;
  fixHint?: string;
  message: string;
  scope?: string;
  severity: PlatformDiagnosticSeverity;
  targetId?: string;
}

/** Live snapshot consumed by the React Studio shell and sidecar replay cache. */
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

/** Studio connection status presented by the live UI. */
export type StudioConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error'
  | 'reconnecting'
  | 'restarting'
  | 'stale'
  | 'static';

/** Studio connection state used by sidecar/UI state machines. */
export interface StudioConnectionState {
  lastEventAt?: string;
  message?: string;
  status: StudioConnectionStatus;
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

/** Runtime/app restart lifecycle hint emitted by CLI-owned dev supervision when available. */
export interface StudioRestartPayload {
  phase: 'scheduled' | 'starting' | 'started' | 'stopping' | 'stopped';
  reason?: string;
}

/** Runtime/app disconnect lifecycle hint emitted when the local bridge loses the app process. */
export interface StudioDisconnectPayload {
  reason?: string;
}

/** Event envelope exchanged between runtime, CLI sidecar, and Studio UI. */
export type StudioLiveEvent =
  | StudioLiveEventBase<'disconnect', StudioDisconnectPayload>
  | StudioLiveEventBase<'diagnostic', StudioLiveDiagnostic>
  | StudioLiveEventBase<'heartbeat', StudioHeartbeatPayload>
  | StudioLiveEventBase<'request', StudioRequestTrace>
  | StudioLiveEventBase<'restart', StudioRestartPayload>
  | StudioLiveEventBase<'snapshot', StudioLiveSnapshot>
  | StudioLiveEventBase<'timing', BootstrapTimingDiagnostics>;

/**
 * Filter state applied to the loaded platform snapshot inside Studio.
 */
export interface FilterState {
  query: string;
  readinessStatuses: PlatformReadinessStatus[];
  severities: PlatformDiagnosticSeverity[];
}

/**
 * Parsed Studio payload together with the original JSON source.
 */
export interface ParsedPayload {
  payload: StudioPayload;
  rawJson: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isReadinessStatus(value: unknown): value is PlatformReadinessStatus {
  return value === 'ready' || value === 'not-ready' || value === 'degraded';
}

function isHealthStatus(value: unknown): value is PlatformSnapshot['health']['status'] {
  return value === 'healthy' || value === 'unhealthy' || value === 'degraded';
}

function isDiagnosticSeverity(value: unknown): value is PlatformDiagnosticSeverity {
  return value === 'error' || value === 'warning' || value === 'info';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }

  return value;
}

function validateOptionalString(value: unknown, message: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return validateString(value, message);
}

function validateOptionalNumber(value: unknown, message: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isNumber(value)) {
    throw new Error(message);
  }

  return value;
}

function validateMetadata(value: unknown, message: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(message);
  }

  return value;
}

function isStudioGraphNodeKind(value: unknown): value is StudioGraphNodeKind {
  return value === 'module'
    || value === 'provider'
    || value === 'controller'
    || value === 'route'
    || value === 'platform'
    || value === 'external';
}

function isStudioGraphEdgeKind(value: unknown): value is StudioGraphEdgeKind {
  return value === 'imports'
    || value === 'owns_provider'
    || value === 'owns_controller'
    || value === 'exposes_route'
    || value === 'depends_on'
    || value === 'exports';
}

function isStudioRequestStatus(value: unknown): value is StudioRequestStatus {
  return value === 'started'
    || value === 'matched'
    || value === 'succeeded'
    || value === 'failed'
    || value === 'finished';
}

function validateStudioGraphNode(value: unknown): StudioGraphNode {
  if (!isRecord(value) || !isStudioGraphNodeKind(value.kind)) {
    throw new Error('Invalid Studio live graph node payload.');
  }

  const node: StudioGraphNode = {
    id: validateString(value.id, 'Invalid Studio live graph node payload.'),
    kind: value.kind,
    label: validateString(value.label, 'Invalid Studio live graph node payload.'),
  };

  const metadata = validateMetadata(value.metadata, 'Invalid Studio live graph node metadata payload.');
  if (metadata) {
    node.metadata = metadata;
  }

  if (value.status !== undefined) {
    if (value.status !== 'active' && value.status !== 'idle' && value.status !== 'warning' && value.status !== 'error') {
      throw new Error('Invalid Studio live graph node status payload.');
    }

    node.status = value.status;
  }

  return node;
}

function validateStudioGraphEdge(value: unknown): StudioGraphEdge {
  if (!isRecord(value) || !isStudioGraphEdgeKind(value.kind)) {
    throw new Error('Invalid Studio live graph edge payload.');
  }

  const edge: StudioGraphEdge = {
    from: validateString(value.from, 'Invalid Studio live graph edge payload.'),
    id: validateString(value.id, 'Invalid Studio live graph edge payload.'),
    kind: value.kind,
    to: validateString(value.to, 'Invalid Studio live graph edge payload.'),
  };

  const label = validateOptionalString(value.label, 'Invalid Studio live graph edge label payload.');
  if (label !== undefined) {
    edge.label = label;
  }

  const metadata = validateMetadata(value.metadata, 'Invalid Studio live graph edge metadata payload.');
  if (metadata) {
    edge.metadata = metadata;
  }

  return edge;
}

function validateStudioRouteDescriptor(value: unknown): StudioRouteDescriptor {
  if (!isRecord(value)) {
    throw new Error('Invalid Studio live route descriptor payload.');
  }

  const route: StudioRouteDescriptor = {
    controller: validateString(value.controller, 'Invalid Studio live route descriptor payload.'),
    handler: validateString(value.handler, 'Invalid Studio live route descriptor payload.'),
    id: validateString(value.id, 'Invalid Studio live route descriptor payload.'),
    method: validateString(value.method, 'Invalid Studio live route descriptor payload.'),
    path: validateString(value.path, 'Invalid Studio live route descriptor payload.'),
  };

  const moduleName = validateOptionalString(value.module, 'Invalid Studio live route descriptor module payload.');
  if (moduleName !== undefined) {
    route.module = moduleName;
  }

  const version = validateOptionalString(value.version, 'Invalid Studio live route descriptor version payload.');
  if (version !== undefined) {
    route.version = version;
  }

  return route;
}

function validateStudioRequestTrace(value: unknown): StudioRequestTrace {
  if (!isRecord(value) || !isStudioRequestStatus(value.status)) {
    throw new Error('Invalid Studio live request trace payload.');
  }

  const privateRequestFieldNames = [
    'body',
    'headers',
    'payload',
    'rawBody',
    'requestBody',
    'responseBody',
  ];

  for (const fieldName of privateRequestFieldNames) {
    if (hasOwn(value, fieldName)) {
      throw new Error('Studio live request traces must not include request or response body payload fields.');
    }
  }

  const trace: StudioRequestTrace = {
    method: validateString(value.method, 'Invalid Studio live request trace payload.'),
    path: validateString(value.path, 'Invalid Studio live request trace payload.'),
    requestId: validateString(value.requestId, 'Invalid Studio live request trace payload.'),
    startedAt: validateString(value.startedAt, 'Invalid Studio live request trace payload.'),
    status: value.status,
    url: validateString(value.url, 'Invalid Studio live request trace payload.'),
  };

  for (const key of ['controller', 'finishedAt', 'handler', 'routeId'] as const) {
    const stringValue = validateOptionalString(value[key], 'Invalid Studio live request trace optional string payload.');
    if (stringValue !== undefined) {
      trace[key] = stringValue;
    }
  }

  const durationMs = validateOptionalNumber(value.durationMs, 'Invalid Studio live request trace duration payload.');
  if (durationMs !== undefined) {
    trace.durationMs = durationMs;
  }

  const statusCode = validateOptionalNumber(value.statusCode, 'Invalid Studio live request trace status code payload.');
  if (statusCode !== undefined) {
    trace.statusCode = statusCode;
  }

  if (value.error !== undefined) {
    if (!isRecord(value.error)) {
      throw new Error('Invalid Studio live request trace error payload.');
    }

    trace.error = {
      message: validateString(value.error.message, 'Invalid Studio live request trace error payload.'),
    };

    const errorName = validateOptionalString(value.error.name, 'Invalid Studio live request trace error name payload.');
    if (errorName !== undefined) {
      trace.error.name = errorName;
    }
  }

  return trace;
}

function validateStudioLiveDiagnostic(value: unknown): StudioLiveDiagnostic {
  if (!isRecord(value) || !isDiagnosticSeverity(value.severity)) {
    throw new Error('Invalid Studio live diagnostic payload.');
  }

  const diagnostic: StudioLiveDiagnostic = {
    code: validateString(value.code, 'Invalid Studio live diagnostic payload.'),
    message: validateString(value.message, 'Invalid Studio live diagnostic payload.'),
    severity: value.severity,
  };

  for (const key of ['fixHint', 'scope', 'targetId'] as const) {
    const stringValue = validateOptionalString(value[key], 'Invalid Studio live diagnostic optional field payload.');
    if (stringValue !== undefined) {
      diagnostic[key] = stringValue;
    }
  }

  return diagnostic;
}

function validateStudioRestartPayload(value: unknown): StudioRestartPayload {
  if (!isRecord(value)) {
    throw new Error('Invalid Studio live restart payload.');
  }

  const phase = value.phase;
  if (phase !== 'scheduled' && phase !== 'starting' && phase !== 'started' && phase !== 'stopping' && phase !== 'stopped') {
    throw new Error('Invalid Studio live restart phase payload.');
  }

  const payload: StudioRestartPayload = { phase };
  const reason = validateOptionalString(value.reason, 'Invalid Studio live restart reason payload.');
  if (reason !== undefined) {
    payload.reason = reason;
  }

  return payload;
}

function validateStudioDisconnectPayload(value: unknown): StudioDisconnectPayload {
  if (!isRecord(value)) {
    throw new Error('Invalid Studio live disconnect payload.');
  }

  const reason = validateOptionalString(value.reason, 'Invalid Studio live disconnect reason payload.');
  return reason === undefined ? {} : { reason };
}

function validateStudioLiveSnapshot(value: unknown): StudioLiveSnapshot {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.graph)) {
    throw new Error('Invalid Studio live snapshot payload.');
  }

  if (!Array.isArray(value.graph.nodes) || !Array.isArray(value.graph.edges) || !Array.isArray(value.routes) || !Array.isArray(value.diagnostics) || !Array.isArray(value.requests)) {
    throw new Error('Invalid Studio live snapshot payload.');
  }

  const timing = validateTiming(value.timing);
  const snapshot: StudioLiveSnapshot = {
    appId: validateString(value.appId, 'Invalid Studio live snapshot payload.'),
    diagnostics: value.diagnostics.map((diagnostic) => validateStudioLiveDiagnostic(diagnostic)),
    generatedAt: validateString(value.generatedAt, 'Invalid Studio live snapshot payload.'),
    graph: {
      edges: value.graph.edges.map((edge) => validateStudioGraphEdge(edge)),
      nodes: value.graph.nodes.map((node) => validateStudioGraphNode(node)),
    },
    requests: value.requests.map((request) => validateStudioRequestTrace(request)),
    routes: value.routes.map((route) => validateStudioRouteDescriptor(route)),
    version: 1,
  };

  if (timing) {
    snapshot.timing = timing;
  }

  return snapshot;
}

function validateStudioLiveEventSource(value: unknown): StudioLiveEventSource {
  if (!isRecord(value)) {
    throw new Error('Invalid Studio live event source payload.');
  }

  const runtime = value.runtime;
  if (runtime !== 'node' && runtime !== 'bun' && runtime !== 'deno' && runtime !== 'worker' && runtime !== 'unknown') {
    throw new Error('Invalid Studio live event runtime payload.');
  }

  return {
    appId: validateString(value.appId, 'Invalid Studio live event source payload.'),
    runtime,
  };
}

function validateStudioLiveEventPayload(type: unknown, payload: unknown): StudioLiveEvent['payload'] {
  if (type === 'snapshot') {
    return validateStudioLiveSnapshot(payload);
  }

  if (type === 'request') {
    return validateStudioRequestTrace(payload);
  }

  if (type === 'timing') {
    const timing = validateTiming(payload);
    if (!timing) {
      throw new Error('Invalid Studio live timing event payload.');
    }

    return timing;
  }

  if (type === 'diagnostic') {
    return validateStudioLiveDiagnostic(payload);
  }

  if (type === 'heartbeat') {
    if (!isRecord(payload)) {
      throw new Error('Invalid Studio live heartbeat payload.');
    }

    const uptimeMs = validateOptionalNumber(payload.uptimeMs, 'Invalid Studio live heartbeat uptime payload.');
    return uptimeMs === undefined ? {} : { uptimeMs };
  }

  if (type === 'restart') {
    return validateStudioRestartPayload(payload);
  }

  if (type === 'disconnect') {
    return validateStudioDisconnectPayload(payload);
  }

  throw new Error('Invalid Studio live event type payload.');
}

/**
 * Validates a runtime-connected Studio event envelope.
 *
 * @param value Candidate event parsed from JSON or received through SSE.
 * @returns The typed Studio live event.
 * @throws Error when the event does not match the live Studio contract.
 */
export function validateStudioLiveEvent(value: unknown): StudioLiveEvent {
  if (!isRecord(value) || value.version !== 1 || !isNumber(value.sequence)) {
    throw new Error('Invalid Studio live event payload.');
  }

  const type = value.type;
  const payload = validateStudioLiveEventPayload(type, value.payload);
  const eventBase = {
    emittedAt: validateString(value.emittedAt, 'Invalid Studio live event payload.'),
    epoch: validateString(value.epoch, 'Invalid Studio live event payload.'),
    eventId: validateString(value.eventId, 'Invalid Studio live event payload.'),
    sequence: value.sequence,
    source: validateStudioLiveEventSource(value.source),
    version: 1 as const,
  };

  if (type === 'snapshot') {
    return { ...eventBase, payload: payload as StudioLiveSnapshot, type };
  }

  if (type === 'request') {
    return { ...eventBase, payload: payload as StudioRequestTrace, type };
  }

  if (type === 'timing') {
    return { ...eventBase, payload: payload as BootstrapTimingDiagnostics, type };
  }

  if (type === 'diagnostic') {
    return { ...eventBase, payload: payload as StudioLiveDiagnostic, type };
  }

  if (type === 'restart') {
    return { ...eventBase, payload: payload as StudioRestartPayload, type };
  }

  if (type === 'disconnect') {
    return { ...eventBase, payload: payload as StudioDisconnectPayload, type };
  }

  return { ...eventBase, payload: payload as StudioHeartbeatPayload, type: 'heartbeat' };
}

/**
 * Parses a live Studio event JSON envelope from the runtime sidecar stream.
 *
 * @param rawJson Raw JSON encoded event.
 * @returns The validated Studio live event.
 */
export function parseStudioLiveEvent(rawJson: string): StudioLiveEvent {
  return validateStudioLiveEvent(JSON.parse(rawJson) as unknown);
}

/**
 * Runtime-safe type guard for Studio live event envelopes.
 *
 * @param value Candidate value.
 * @returns `true` when the value matches the live Studio event contract.
 */
export function isStudioLiveEvent(value: unknown): value is StudioLiveEvent {
  try {
    validateStudioLiveEvent(value);
    return true;
  } catch {
    return false;
  }
}

function validateSnapshot(value: unknown): PlatformShellSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.generatedAt !== 'string'
    || !isRecord(value.readiness)
    || !isRecord(value.health)
    || !Array.isArray(value.components)
    || !Array.isArray(value.diagnostics)
  ) {
    throw new Error('Invalid platform snapshot payload.');
  }

  if (!isReadinessStatus(value.readiness.status) || typeof value.readiness.critical !== 'boolean') {
    throw new Error('Invalid aggregate readiness in platform snapshot payload.');
  }

  if (!isHealthStatus(value.health.status)) {
    throw new Error('Invalid aggregate health in platform snapshot payload.');
  }

  for (const component of value.components) {
    if (!isRecord(component)) {
      throw new Error('Invalid component entry in platform snapshot payload.');
    }

    if (
      typeof component.id !== 'string'
      || typeof component.kind !== 'string'
      || typeof component.state !== 'string'
      || !isRecord(component.readiness)
      || !isRecord(component.health)
      || !isStringArray(component.dependencies)
      || !isRecord(component.telemetry)
      || !isRecord(component.ownership)
      || !isRecord(component.details)
    ) {
      throw new Error('Invalid component shape in platform snapshot payload.');
    }

    if (!isReadinessStatus(component.readiness.status) || typeof component.readiness.critical !== 'boolean') {
      throw new Error('Invalid component readiness in platform snapshot payload.');
    }

    if (!isHealthStatus(component.health.status)) {
      throw new Error('Invalid component health in platform snapshot payload.');
    }

    if (
      typeof component.telemetry.namespace !== 'string'
      || !isRecord(component.telemetry.tags)
      || typeof component.ownership.ownsResources !== 'boolean'
      || typeof component.ownership.externallyManaged !== 'boolean'
    ) {
      throw new Error('Invalid component telemetry/ownership in platform snapshot payload.');
    }
  }

  for (const issue of value.diagnostics) {
    if (!isRecord(issue)) {
      throw new Error('Invalid diagnostics issue entry in platform snapshot payload.');
    }

    if (
      typeof issue.code !== 'string'
      || !isDiagnosticSeverity(issue.severity)
      || typeof issue.componentId !== 'string'
      || typeof issue.message !== 'string'
    ) {
      throw new Error('Invalid diagnostics issue shape in platform snapshot payload.');
    }

    if (
      (issue.cause !== undefined && typeof issue.cause !== 'string')
      || (issue.fixHint !== undefined && typeof issue.fixHint !== 'string')
      || (issue.docsUrl !== undefined && typeof issue.docsUrl !== 'string')
      || (issue.dependsOn !== undefined && !isStringArray(issue.dependsOn))
    ) {
      throw new Error('Invalid optional diagnostics issue fields in platform snapshot payload.');
    }
  }

  return value as unknown as PlatformShellSnapshot;
}

function validateTiming(value: unknown): BootstrapTimingDiagnostics | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.version !== 1) {
    throw new Error('Unsupported bootstrap timing version. Expected version: 1.');
  }

  if (typeof value.totalMs !== 'number' || !Array.isArray(value.phases)) {
    throw new Error('Invalid bootstrap timing payload.');
  }

  for (const phase of value.phases) {
    if (!isRecord(phase) || typeof phase.name !== 'string' || typeof phase.durationMs !== 'number') {
      throw new Error('Invalid phase entry in bootstrap timing payload.');
    }
  }

  return value as unknown as BootstrapTimingDiagnostics;
}

function validateReportSummary(value: unknown): StudioReportSummary {
  if (!isRecord(value)) {
    throw new Error('Invalid inspect report summary payload.');
  }

  if (
    typeof value.componentCount !== 'number'
    || typeof value.diagnosticCount !== 'number'
    || typeof value.errorCount !== 'number'
    || !isHealthStatus(value.healthStatus)
    || !isReadinessStatus(value.readinessStatus)
    || typeof value.timingTotalMs !== 'number'
    || typeof value.warningCount !== 'number'
  ) {
    throw new Error('Invalid inspect report summary payload.');
  }

  return value as unknown as StudioReportSummary;
}

function validateReportSummaryConsistency(
  summary: StudioReportSummary,
  snapshot: PlatformShellSnapshot,
  timing: BootstrapTimingDiagnostics,
): void {
  const errorCount = snapshot.diagnostics.filter((diagnostic: PlatformDiagnosticIssue) => diagnostic.severity === 'error').length;
  const warningCount = snapshot.diagnostics.filter((diagnostic: PlatformDiagnosticIssue) => diagnostic.severity === 'warning').length;

  if (
    summary.componentCount !== snapshot.components.length
    || summary.diagnosticCount !== snapshot.diagnostics.length
    || summary.errorCount !== errorCount
    || summary.healthStatus !== snapshot.health.status
    || summary.readinessStatus !== snapshot.readiness.status
    || summary.timingTotalMs !== timing.totalMs
    || summary.warningCount !== warningCount
  ) {
    throw new Error('Inspect report summary does not match snapshot and timing payload data.');
  }
}

function isReportArtifactEnvelope(value: Record<string, unknown>): boolean {
  return value.summary !== undefined
    || (hasOwn(value, 'snapshot') && hasOwn(value, 'timing') && (hasOwn(value, 'generatedAt') || hasOwn(value, 'version')));
}

function validateReport(value: unknown, snapshot: PlatformShellSnapshot | null, timing: BootstrapTimingDiagnostics | null): StudioReportArtifact | null {
  if (!isRecord(value) || !isReportArtifactEnvelope(value)) {
    return null;
  }

  if (value.summary === undefined || value.version !== 1 || typeof value.generatedAt !== 'string' || !snapshot || !timing) {
    throw new Error('Invalid inspect report artifact payload.');
  }

  const summary = validateReportSummary(value.summary);
  validateReportSummaryConsistency(summary, snapshot, timing);

  return {
    generatedAt: value.generatedAt,
    snapshot,
    summary,
    timing,
    version: 1,
  };
}

/**
 * Parses a Studio JSON file into the documented snapshot/timing envelope.
 *
 * @param rawJson - Raw JSON emitted by `fluo inspect` or a Studio-compatible producer.
 * @returns The validated Studio payload plus the original JSON string.
 * @throws Error when the JSON does not match the supported Studio file contracts.
 */
export function parseStudioPayload(rawJson: string): ParsedPayload {
  const parsed = JSON.parse(rawJson) as unknown;
  const envelope = isRecord(parsed) ? parsed : undefined;
  const hasSnapshotEnvelope = envelope !== undefined && hasOwn(envelope, 'snapshot');
  const hasTimingEnvelope = envelope !== undefined && hasOwn(envelope, 'timing');
  const standaloneTiming = envelope !== undefined
    && !hasSnapshotEnvelope
    && !hasTimingEnvelope
    && hasOwn(envelope, 'version')
    && hasOwn(envelope, 'totalMs')
    && hasOwn(envelope, 'phases');

  const snapshot = validateSnapshot(hasSnapshotEnvelope ? envelope.snapshot : standaloneTiming ? undefined : parsed);
  const timing = validateTiming(hasTimingEnvelope ? envelope.timing : !snapshot ? parsed : undefined);
  const report = validateReport(parsed, snapshot, timing);

  if (!snapshot && !timing) {
    throw new Error('Unsupported file format. Expected platform snapshot JSON or timing JSON.');
  }

  return {
    payload: {
      ...(report ? { report } : {}),
      ...(snapshot ? { snapshot } : {}),
      ...(timing ? { timing } : {}),
    },
    rawJson,
  };
}

/**
 * Applies Studio filter state to a platform snapshot without mutating the input.
 *
 * @param snapshot - The loaded platform snapshot.
 * @param filter - Active readiness, severity, and query filters.
 * @returns A filtered snapshot containing only the matching components and diagnostics.
 */
export function applyFilters(snapshot: PlatformShellSnapshot, filter: FilterState): PlatformShellSnapshot {
  const query = filter.query.trim().toLowerCase();

  const components = snapshot.components.filter((component: PlatformSnapshot) => {
    if (filter.readinessStatuses.length > 0 && !filter.readinessStatuses.includes(component.readiness.status)) {
      return false;
    }

    if (!query) {
      return true;
    }

    return component.id.toLowerCase().includes(query)
      || component.kind.toLowerCase().includes(query)
      || component.dependencies.some((dependency: string) => dependency.toLowerCase().includes(query));
  });

  const diagnostics = snapshot.diagnostics.filter((issue: PlatformDiagnosticIssue) => {
    if (filter.severities.length > 0 && !filter.severities.includes(issue.severity)) {
      return false;
    }

    if (!query) {
      return true;
    }

    return issue.code.toLowerCase().includes(query)
      || issue.componentId.toLowerCase().includes(query)
      || issue.message.toLowerCase().includes(query)
      || (issue.cause?.toLowerCase().includes(query) ?? false)
      || (issue.fixHint?.toLowerCase().includes(query) ?? false)
      || (issue.docsUrl?.toLowerCase().includes(query) ?? false)
      || (issue.dependsOn?.some((dependency: string) => dependency.toLowerCase().includes(query)) ?? false);
  });

  return {
    ...snapshot,
    components,
    diagnostics,
  };
}

function escapeMermaidText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\n')
    .replaceAll('\n', '\\n');
}

function sanitizeMermaidNodeIdSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, '_');
}

function hashMermaidNodeId(value: string): string {
  let hash = 2_166_136_261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function createExternalMermaidNodeId(value: string): string {
  return `EXT_${sanitizeMermaidNodeIdSegment(value)}_${hashMermaidNodeId(value)}`;
}

/**
 * Renders the loaded platform snapshot as a Mermaid dependency graph.
 *
 * @remarks
 * `@fluojs/studio` owns the snapshot consumption and graph rendering contract. Runtime packages remain the
 * snapshot producers, while automation and viewer callers use this helper to turn a loaded snapshot into a
 * stable Mermaid graph.
 *
 * @param snapshot - The platform snapshot to render.
 * @returns Mermaid graph text suitable for docs or clipboard export.
 */
export function renderMermaid(snapshot: PlatformShellSnapshot): string {
  const lines: string[] = ['graph TD'];
  const nodeByComponent = new Map<string, string>();
  const externalNodeByDependency = new Map<string, string>();
  const internalComponentIds = new Set(snapshot.components.map((component) => component.id));

  if (snapshot.components.length === 0) {
    lines.push('  EMPTY["No registered platform components"]');
    return lines.join('\n');
  }

  for (const [index, component] of snapshot.components.entries()) {
    const nodeId = `C${String(index + 1)}`;
    nodeByComponent.set(component.id, nodeId);
    lines.push(`  ${nodeId}["${escapeMermaidText(component.id)}\\nkind: ${escapeMermaidText(component.kind)}\\nreadiness: ${component.readiness.status}\\nhealth: ${component.health.status}"]`);
  }

  for (const component of snapshot.components) {
    const from = nodeByComponent.get(component.id);
    if (!from) {
      continue;
    }

    for (const dependency of component.dependencies) {
      const to = nodeByComponent.get(dependency);

      if (to) {
        lines.push(`  ${from} --> ${to}`);
        continue;
      }

      if (internalComponentIds.has(dependency)) {
        continue;
      }

      let externalNode = externalNodeByDependency.get(dependency);

      if (!externalNode) {
        externalNode = createExternalMermaidNodeId(dependency);
        externalNodeByDependency.set(dependency, externalNode);
        lines.push(`  ${externalNode}["${escapeMermaidText(dependency)}"]`);
      }

      lines.push(`  ${from} --> ${externalNode}`);
    }
  }

  const degradedNodes: string[] = [];
  const notReadyNodes: string[] = [];
  for (const component of snapshot.components) {
    const nodeId = nodeByComponent.get(component.id);
    if (!nodeId) {
      continue;
    }

    if (component.readiness.status === 'degraded') {
      degradedNodes.push(nodeId);
    }

    if (component.readiness.status === 'not-ready') {
      notReadyNodes.push(nodeId);
    }
  }

  if (degradedNodes.length > 0) {
    lines.push(`  class ${degradedNodes.join(',')} degraded`);
    lines.push('  classDef degraded stroke:#f59e0b,stroke-width:2px');
  }

  if (notReadyNodes.length > 0) {
    lines.push(`  class ${notReadyNodes.join(',')} notReady`);
    lines.push('  classDef notReady stroke:#ef4444,stroke-width:2px');
  }

  return lines.join('\n');
}
