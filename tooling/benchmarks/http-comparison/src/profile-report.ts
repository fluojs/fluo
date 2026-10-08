import { createHash } from 'node:crypto';
import type { monitorServer } from './resources';
import { SCENARIOS, STAGE_SCENARIOS } from './scenarios';
import type { Platform } from './targets';
import { TARGETS } from './targets';
import type { Measurement } from './traffic';

export const PROFILE_MODES = ['cpu', 'allocation', 'gc-eventloop'] as const;
export type ProfileMode = typeof PROFILE_MODES[number];
export type CaptureStatus = 'supported' | 'unsupported' | 'blocked' | 'failed';
export interface ProfileCondition {
  readonly target: string;
  readonly platform: Platform;
  readonly scenario: string;
  readonly configuration: 'default' | 'equivalent';
  readonly connections: number;
  readonly repeat: number;
  readonly mode: ProfileMode;
}
export interface ServingSubject {
  readonly kind: 'process' | 'application-isolate';
  readonly pid: number;
  readonly launcherPid: number;
  readonly isolateId: string | null;
  readonly inspectorUrl: string;
  readonly runtime: Readonly<Record<string, unknown>>;
}
export interface RawArtifact {
  readonly path: string; readonly sha256: string; readonly bytes: number;
  readonly kind: 'protocol' | 'identity' | 'profile' | 'diagnostics' | 'stdout' | 'stderr' | 'build';
}
export interface TimeAnchor {
  readonly collectorBeforeMs: number; readonly servingMs: number; readonly collectorAfterMs: number;
  readonly servingUptimeMs: number | null;
}
export type ProfileRun = Awaited<ReturnType<typeof monitorServer<Measurement>>> & {
  readonly phase: 'control-before' | 'capture' | 'control-after';
  readonly instrumentation: 'none' | ProfileMode;
  readonly launcherPid: number;
  readonly startedMs: number;
  readonly endedMs: number;
  readonly launch: { readonly command: string; readonly args: readonly string[]; readonly cwd: string; readonly env: Readonly<Record<string, string>> };
  readonly exit: { readonly code: number | null; readonly signal: string | null };
};
export interface ProfileCapture {
  readonly condition: ProfileCondition;
  readonly status: CaptureStatus;
  readonly reason: string | null;
  readonly subject: ServingSubject | null;
  readonly format: 'v8-cpu' | 'jsc-cpu' | 'v8-allocation' | 'jsc-heap' | 'gc-eventloop' | null;
  readonly anchors: readonly TimeAnchor[];
  readonly artifacts: readonly RawArtifact[];
  readonly profilePath: string | null;
  readonly identityPath: string | null;
  readonly runs: readonly ProfileRun[];
  readonly provenanceSha256: string;
  readonly limitations: readonly string[];
}

export class ProfileFailure extends Error {
  constructor(readonly phase: string, message: string, readonly detail: unknown = null) {
    super(message);
    this.name = 'ProfileFailure';
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProfileFailure('parse', 'Expected a JSON object');
  return Object.fromEntries(Object.entries(value));
}
export function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new ProfileFailure('parse', 'Expected a JSON array');
  return value;
}
export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function requestFrame(value: unknown): boolean {
  const frame = object(value);
  const name = String(frame.functionName ?? frame.name ?? '');
  const url = String(frame.url ?? '');
  if (/^\(program\)$|^\(root\)$|^createNativeStage$|^resolveStageModule$/.test(name)) return false;
  const stage = /shared\/(?:native-stages|fluo-stages|stage-workloads)\.[cm]?[jt]s$/.test(url);
  const line = frame.lineNumber ?? (typeof frame.line === 'number' ? frame.line - 1 : null);
  const stageHandler = /^(?:read|canActivate|serviceResult|bodyFields|materializeStageDto|serializedStage)$/.test(name)
    || (name === '' && ((/shared\/native-stages\.js$/.test(url) && line === 4)
      || (/shared\/native-stages\.ts$/.test(url) && line === 5)));
  const fastRequest = /packages\/http\/(?:dist|src)\/dispatch\//.test(url)
    && /^(?:dispatch|dispatchMatchedRoute|runDispatchPipeline|tryFastPathExecution|executeFastPath|consumeFrameworkRequestNativeRouteHandoff)$/.test(name);
  const nestRequest = /(?:^|\/)(?:src\/nestjs|dist\/nestjs\/nestjs)\/server\.[jt]s$/.test(url)
    && /^(?:search|quote|project|tasks|task|preview|comments)$/.test(name);
  const nestStageRequest = /(?:^|\/)(?:src\/shared|dist\/nestjs\/shared)\/nest-stages\.[jt]s$/.test(url)
    && /^(?:read|canActivate|transform)$/.test(name);
  // Bundling removes package paths and may inline workload helpers. Ambiguous
  // read/handle and anonymous frames still require a verified request ancestor.
  const denoBundleRequest = /(?:^|\/)dist\/fluo-deno\/server\.mjs$/.test(url)
    && /^(?:search|quote|project|tasks|task|preview|comments|createDeferredWebFrameworkRequest|createDispatchRequest|createDispatchContext|startWebRequestDispatch|writeSuccessResponse|runWithRequestContext|dispatchMatchedRoute|runDispatchPipeline|tryFastPathExecution|executeFastPath|canActivate|serviceResult|bodyFields|serializedStage)$/.test(name);
  const workerRequest = url === 'server.js'
    && /^(?:startWebRequestDispatch|createDeferredWebFrameworkRequest|createDispatchContext|dispatchMatchedRoute|runDispatchPipeline|tryFastPathExecution|executeFastPath|writeSuccessResponse)$/.test(name);
  const nextRequest = /\/next\/dist\/server\/(?:base-server|next-server)\.js$/.test(url)
    && /^(?:handleRequest|handleRequestImpl|renderToResponse|renderToResponseImpl|renderToResponseWithComponents|renderToResponseWithComponentsImpl)$/.test(name);
  const fluoController = /shared\/fluo-app\.[jt]s$/.test(url)
    && /^(?:search|quote|project|tasks|task|preview|comments)$/.test(name);
  return /^(?:readSearchLocal|jsonCommandLocal|restRouteMixLocal|nativeResponse|nativeFetch)$/.test(name)
    || (stage && stageHandler) || fastRequest || nestRequest || nestStageRequest || denoBundleRequest || workerRequest || nextRequest || fluoController;
}
export function requestSamples(profile: unknown, format: ProfileCapture['format']): number {
  const data = object(profile);
  switch (format) {
    case 'v8-cpu': {
      const nodes = new Map(array(data.nodes).map((n) => {
        const node = object(n);
        return [node.id, node] as const;
      }));
      const requestIds = new Set<unknown>();
      const visited = new Set<unknown>();
      const visit = (id: unknown, parentIsRequest: boolean): void => {
        if (visited.has(id)) throw new ProfileFailure('profile', 'Cyclic or duplicate CPU node');
        visited.add(id);
        const node = nodes.get(id);
        if (!node) throw new ProfileFailure('profile', 'CPU profile refers to a missing node');
        const matched = parentIsRequest || requestFrame(node.callFrame);
        if (matched) requestIds.add(id);
        for (const child of node.children === undefined ? [] : array(node.children)) visit(child, matched);
      };
      const root = array(data.nodes)[0];
      if (root !== undefined) visit(object(root).id, false);
      return array(data.samples).filter((id) => requestIds.has(id)).length;
    }
    case 'jsc-cpu':
      return array(data.stackTraces).filter((stack) => array(object(stack).stackFrames).some(requestFrame)).length;
    case 'v8-allocation': {
      const ids = new Set<unknown>();
      const visit = (value: unknown, parentIsRequest: boolean): void => {
        const node = object(value);
        const matched = parentIsRequest || requestFrame(node.callFrame);
        if (matched) ids.add(node.id);
        for (const child of array(node.children)) visit(child, matched);
      };
      visit(data.head, false);
      return array(data.samples).filter((sample) => ids.has(object(sample).nodeId)).length;
    }
    case 'jsc-heap':
      return array(data.nodes).length > 0 && array(data.edges).length > 0 ? 1 : 0;
    case 'gc-eventloop': case null: return 0;
  }
}

export function conditionKey(condition: ProfileCondition): string {
  return JSON.stringify([condition.target, condition.platform, condition.scenario, condition.configuration, condition.connections, condition.repeat, condition.mode]);
}

export function validateCapture(capture: ProfileCapture, raw: ReadonlyMap<string, Uint8Array>): readonly string[] {
  const errors: string[] = [];
  for (const artifact of capture.artifacts) {
    const bytes = raw.get(artifact.path);
    if (artifact.path.startsWith('/') || artifact.path.split('/').includes('..')) errors.push('raw-path');
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) errors.push('raw-hash-or-missing');
  }
  if (!/^[a-f0-9]{64}$/.test(capture.provenanceSha256)) errors.push('provenance');
  const provenance = capture.artifacts.find((artifact) => artifact.kind === 'build' && artifact.path.endsWith('/provenance.json'));
  if (!provenance || provenance.sha256 !== capture.provenanceSha256) errors.push('missing-provenance-bytes');
  if (capture.status !== 'supported') {
    if (!capture.reason) errors.push('missing-reason');
    if (capture.status === 'unsupported') {
      const protocol = capture.artifacts.filter((a) => a.kind === 'protocol').map((a) => new TextDecoder().decode(raw.get(a.path))).join('\n');
      let rejected = false;
      const methods = new Map<unknown, unknown>();
      try {
        for (const line of protocol.split('\n').filter(Boolean)) {
          const entry = object(JSON.parse(line));
          if (typeof entry.sent === 'string') {
            const sent = object(JSON.parse(entry.sent));
            methods.set(sent.id, sent.method);
          }
          if (typeof entry.received === 'string') {
            const reply = object(JSON.parse(entry.received));
            if (methods.get(reply.id) === 'Tracing.start' && reply.error && object(reply.error).code === -32601) rejected = true;
          }
        }
      } catch (error) { if (!(error instanceof Error)) throw error; }
      if (!rejected || capture.condition.mode !== 'gc-eventloop' || capture.condition.platform !== 'workers') errors.push('unproven-unsupported');
    } else { errors.push(capture.status); return errors; }
  }
  if (!capture.subject || !capture.identityPath
    || !capture.artifacts.some((a) => a.path === capture.identityPath && a.kind === 'identity')
    || (capture.status === 'supported' && (capture.reason !== null || !capture.profilePath
      || !capture.artifacts.some((a) => a.path === capture.profilePath && a.kind === 'profile')))) errors.push('missing-subject-or-profile');
  const formats = capture.condition.mode === 'cpu' ? ['v8-cpu', 'jsc-cpu']
    : capture.condition.mode === 'allocation' ? ['v8-allocation', 'jsc-heap'] : ['gc-eventloop'];
  if (capture.status === 'supported' && !formats.includes(capture.format ?? '')) errors.push('wrong-profile-mode');
  const phases = ['control-before', 'capture', 'control-after'];
  if (capture.runs.length !== 3 || capture.runs.some((run, index) => run.phase !== phases[index]
    || run.instrumentation !== (index === 1 ? capture.condition.mode : 'none')
    || run.value.result.requests.total <= 0 || run.value.result.errors !== 0 || run.value.result.timeouts !== 0
    || run.value.result.non2xx !== 0 || run.value.result.mismatches !== 0 || run.value.statusMismatches !== 0
    || !(run.endedMs > run.startedMs) || (run.exit.signal !== null && run.exit.signal !== 'SIGTERM')
    || (run.exit.code !== null && run.exit.code !== 0 && !(capture.condition.platform === 'nextjs' && run.exit.code === 143)))) errors.push('partial-or-invalid-traffic');
  if (capture.status === 'supported' && (capture.anchors.length !== 2 || capture.anchors.some((a) => !Number.isFinite(a.servingMs)
    || a.collectorAfterMs < a.collectorBeforeMs) || capture.anchors[1]?.servingMs < capture.anchors[0]?.servingMs)) errors.push('time-anchors');
  try {
    const identityBytes = capture.identityPath === null ? undefined : raw.get(capture.identityPath);
    const profileBytes = capture.profilePath === null ? undefined : raw.get(capture.profilePath);
    if (!identityBytes || (capture.status === 'supported' && !profileBytes)) throw new ProfileFailure('validity', 'Missing identity/profile bytes');
    const identity = object(JSON.parse(new TextDecoder().decode(identityBytes)));
    const subject = capture.subject;
    if (!subject || subject.pid !== identity.pid || subject.launcherPid !== capture.runs[1]?.launcherPid
      || subject.inspectorUrl !== identity.inspectorUrl || subject.isolateId !== identity.isolateId
      || subject.kind !== (capture.condition.platform === 'workers' ? 'application-isolate' : 'process')
      || (subject.kind === 'application-isolate' && (!/workerd/.test(String(identity.command)) || !subject.isolateId || identity.workerRuntime !== true))
      || (subject.kind === 'process' && identity.runtimePid !== subject.pid)) errors.push('wrong-serving-subject');
    const profile = profileBytes ? JSON.parse(new TextDecoder().decode(profileBytes)) : null;
    if (capture.status === 'supported' && capture.format === 'v8-cpu') {
      const cpu = object(profile);
      const deltas = cpu.timeDeltas;
      if (typeof cpu.startTime !== 'number' || !Number.isFinite(cpu.startTime) || cpu.startTime < 0
        || typeof cpu.endTime !== 'number' || !Number.isFinite(cpu.endTime) || cpu.endTime <= cpu.startTime
        || !Array.isArray(cpu.samples) || !Array.isArray(deltas) || deltas.length !== cpu.samples.length
        || deltas.some((delta) => typeof delta !== 'number' || !Number.isFinite(delta) || delta < 0)
        || deltas.reduce((sum: number, delta: number) => sum + delta, 0) > cpu.endTime - cpu.startTime) {
        errors.push('invalid-cpu-time-fields');
      }
    }
    if (capture.status === 'supported' && capture.condition.mode === 'gc-eventloop') {
      const diagnostics = object(profile);
      if (subject?.kind === 'application-isolate' || !Number.isFinite(diagnostics.wallDelayMaxMs)
        || typeof diagnostics.wallDelaySamples !== 'number' || diagnostics.wallDelaySamples <= 0) errors.push('invalid-eventloop');
    } else if (capture.status === 'supported' && requestSamples(profile, capture.format) === 0) errors.push('empty-or-startup-profile');
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    errors.push('malformed-profile-or-identity');
  }
  return [...new Set(errors)];
}

export function profileCompleteness(captures: readonly ProfileCapture[], required: readonly ProfileCondition[], raw: ReadonlyMap<string, Uint8Array>) {
  const byKey = new Map(captures.map((capture) => [conditionKey(capture.condition), capture]));
  const errors = captures.flatMap((capture) => validateCapture(capture, raw).map((error) => `${conditionKey(capture.condition)}:${error}`));
  if (byKey.size !== captures.length) errors.push('duplicate-condition');
  for (const condition of required) if (!byKey.has(conditionKey(condition))) errors.push(`missing:${conditionKey(condition)}`);
  if (captures.length !== required.length) errors.push('partial-or-extra-matrix');
  if (new Set(captures.map((capture) => capture.provenanceSha256)).size !== 1) errors.push('mixed-provenance');
  return { status: errors.length === 0 && required.length > 0 ? 'complete' : 'incomplete', expected: required.length, observed: captures.length, errors };
}

export function profileSummary(capture: ProfileCapture) {
  const [before, measured, after] = capture.runs;
  const throughput = (run: ProfileRun | undefined) => run ? run.value.result.requests.total / run.server.wallSeconds : null;
  return {
    condition: capture.condition, status: capture.status, reason: capture.reason, subject: capture.subject,
    raw: capture.artifacts, profilePath: capture.profilePath, limitations: capture.limitations,
    controls: {
      beforeRequestsPerSecond: throughput(before), profiledRequestsPerSecond: throughput(measured), afterRequestsPerSecond: throughput(after),
      latencyPercentilesMs: capture.runs.map((run) => ({ phase: run.phase, ...run.value.latencyPercentilesMs })),
      processTreeCpuSeconds: capture.runs.map((run) => ({ phase: run.phase, value: run.server.cpuSeconds })),
      interpretation: 'Separate instrumented and uninstrumented runs; short controls do not prove capacity or overhead budgets.',
    },
  };
}

export interface StageTimingSample extends Pick<ProfileCondition, 'target' | 'scenario' | 'configuration' | 'connections' | 'repeat'> {
  readonly mode: 'uninstrumented' | ProfileMode;
  readonly provenanceSha256: string;
  readonly source: 'issue3910' | 'historical';
  readonly requests: number;
  readonly errors: number;
  readonly timeouts: number; readonly non2xx: number;
  readonly bodyMismatches: number; readonly statusMismatches: number;
  readonly warmupSeconds: number; readonly durationSeconds: number;
  readonly sourceSha256: string; readonly buildSourceSha256: string; readonly rawSha256: string;
}

export function timingCompleteness(samples: readonly StageTimingSample[], provenanceSha256: string) {
  const expected = new Set<string>();
  const key = (sample: Pick<StageTimingSample, 'target' | 'scenario' | 'configuration' | 'connections' | 'repeat'>) =>
    JSON.stringify([sample.target, sample.scenario, sample.configuration, sample.connections, sample.repeat]);
  for (const target of TARGETS) for (const scenario of [...SCENARIOS, ...STAGE_SCENARIOS])
    for (const configuration of ['default', 'equivalent'] as const) for (const connections of [1, 64])
      for (let repeat = 0; repeat < 3; repeat++) expected.add(key({ target: target.name, scenario: scenario.name, configuration, connections, repeat }));
  const observed = new Set(samples.map(key));
  const errors: string[] = [];
  if (!/^[a-f0-9]{64}$/.test(provenanceSha256) || samples.some((sample) => sample.provenanceSha256 !== provenanceSha256)) errors.push('provenance');
  if (samples.some((sample) => sample.source !== 'issue3910' || sample.mode !== 'uninstrumented')) errors.push('historical-or-instrumented');
  if (samples.some((sample) => !Number.isSafeInteger(sample.requests) || sample.requests <= 0
    || [sample.errors, sample.timeouts, sample.non2xx, sample.bodyMismatches, sample.statusMismatches].some((count) => count !== 0))) errors.push('invalid-traffic');
  if (samples.some((sample) => sample.warmupSeconds !== 5 || sample.durationSeconds !== 15)) errors.push('timing-interval');
  if (samples.some((sample) => !/^[a-f0-9]{64}$/.test(sample.sourceSha256) || sample.sourceSha256 !== sample.buildSourceSha256
    || !/^[a-f0-9]{64}$/.test(sample.rawSha256))) errors.push('source-build-raw-binding');
  if (observed.size !== samples.length) errors.push('duplicate-condition');
  if (samples.length !== 2112 || expected.size !== 2112 || [...observed].some((value) => !expected.has(value))
    || [...expected].some((value) => !observed.has(value))) errors.push('partial-matrix');
  return { status: errors.length === 0 ? 'complete' : 'incomplete', expected: 2112, observed: samples.length, errors };
}
