export interface PlatformOptionsBase {
  id?: string;
  enabled?: boolean;
  readiness?: {
    critical?: boolean;
    timeoutMs?: number;
  };
  shutdown?: {
    timeoutMs?: number;
  };
  diagnostics?: {
    expose?: boolean;
    tags?: Record<string, string>;
  };
  telemetry?: {
    namespace?: string;
    tags?: Record<string, string>;
  };
}

export type PlatformState =
  | 'created'
  | 'validated'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface PlatformComponent {
  id: string;
  kind: string;
  state(): PlatformState;
  validate(): Promise<PlatformValidationResult> | PlatformValidationResult;
  start(): Promise<void>;
  ready(): Promise<PlatformReadinessReport>;
  health(): Promise<PlatformHealthReport>;
  snapshot(): PlatformSnapshot;
  stop(): Promise<void>;
}

export interface PlatformCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'degraded';
  message?: string;
}

export interface PlatformReadinessReport {
  status: 'ready' | 'not-ready' | 'degraded';
  critical: boolean;
  reason?: string;
  checks?: PlatformCheckResult[];
}

export interface PlatformHealthReport {
  status: 'healthy' | 'unhealthy' | 'degraded';
  reason?: string;
  checks?: PlatformCheckResult[];
}

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

export interface PlatformValidationResult {
  ok: boolean;
  issues: PlatformDiagnosticIssue[];
  warnings?: PlatformDiagnosticIssue[];
}

export interface PlatformSnapshot {
  id: string;
  kind: string;
  state: PlatformState;
  readiness: {
    status: PlatformReadinessReport['status'];
    critical: boolean;
    reason?: string;
  };
  health: {
    status: PlatformHealthReport['status'];
    reason?: string;
  };
  dependencies: string[];
  telemetry: {
    namespace: string;
    tags: Record<string, string>;
  };
  ownership: {
    ownsResources: boolean;
    externallyManaged: boolean;
  };
  details: Record<string, unknown>;
}
