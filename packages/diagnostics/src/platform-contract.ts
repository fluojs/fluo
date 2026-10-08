/** Readiness statuses reported by platform components. */
export type PlatformReadinessStatus = 'ready' | 'not-ready' | 'degraded';

/** Health statuses supported by Studio snapshot parsing. */
export type PlatformHealthStatus = 'healthy' | 'unhealthy' | 'degraded';

/** Lifecycle states supported by Studio component diagnostics. */
export type PlatformState =
  | 'created'
  | 'validated'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'failed';

/** Outcome for one named readiness or health probe in a platform report. */
export interface PlatformCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'degraded';
  message?: string;
}

/** Readiness semantics consumed from a platform inspection artifact. */
export interface PlatformReadinessReport {
  status: PlatformReadinessStatus;
  critical: boolean;
  reason?: string;
  checks?: PlatformCheckResult[];
}

/** Health semantics consumed from a platform inspection artifact. */
export interface PlatformHealthReport {
  status: PlatformHealthStatus;
  reason?: string;
  checks?: PlatformCheckResult[];
}

/** Machine-readable issue emitted in a platform inspection artifact. */
export interface PlatformDiagnosticIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  componentId: string;
  message: string;
  cause?: string;
  fixHint?: string;
  dependsOn?: string[];
  docsUrl?: string;
}

/** Component snapshot consumed by Studio graph and diagnostics views. */
export interface PlatformSnapshot {
  id: string;
  kind: string;
  state: PlatformState;
  readiness: {
    status: PlatformReadinessStatus;
    critical: boolean;
    reason?: string;
  };
  health: {
    status: PlatformHealthStatus;
    reason?: string;
  };
  dependencies: string[];
  telemetry: {
    namespace: string;
    tags: Record<string, string>;
  };
  ownership: PlatformResourceOwnership;
  details: Record<string, unknown>;
}

/** Aggregate platform snapshot consumed by Studio static diagnostics. */
export interface PlatformShellSnapshot {
  generatedAt: string;
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  components: PlatformSnapshot[];
  diagnostics: PlatformDiagnosticIssue[];
}


/** Describes who creates and releases a component's resources. */
export interface PlatformResourceOwnership {
  ownsResources: boolean;
  externallyManaged: boolean;
}

/** Shared package status data, retaining the feature's concrete details. */
export interface PlatformStatusSnapshot<TDetails extends Record<string, unknown> = Record<string, unknown>> {
  readiness: PlatformReadinessReport;
  health: PlatformHealthReport;
  ownership: PlatformResourceOwnership;
  details: TDetails;
}

/** Shared persistence status data retained for existing runtime consumers. */
export interface PersistencePlatformStatusSnapshot extends PlatformStatusSnapshot {}

/** Machine-readable validation outcome before component startup. */
export interface PlatformValidationResult {
  ok: boolean;
  issues: PlatformDiagnosticIssue[];
  warnings?: PlatformDiagnosticIssue[];
}
