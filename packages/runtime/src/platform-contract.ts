import type { PlatformState, PlatformCheckResult, PlatformReadinessReport, PlatformHealthReport, PersistencePlatformStatusSnapshot, PlatformDiagnosticIssue, PlatformValidationResult, PlatformSnapshot, PlatformShellSnapshot } from '@fluojs/diagnostics';
export type { PlatformState, PlatformCheckResult, PlatformReadinessReport, PlatformHealthReport, PersistencePlatformStatusSnapshot, PlatformDiagnosticIssue, PlatformValidationResult, PlatformSnapshot, PlatformShellSnapshot } from '@fluojs/diagnostics';

/**
 * Shared configuration knobs understood by runtime platform components.
 */
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

/**
 * Runtime-managed infrastructure component that participates in validation,
 * startup, readiness, health, diagnostics, and shutdown orchestration.
 */
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

/** Registration wrapper used when a component declares platform dependencies. */
export interface PlatformComponentRegistration {
  component: PlatformComponent;
  dependencies?: readonly string[];
}

/** Component registration input accepted by runtime bootstrap options. */
export type PlatformComponentInput = PlatformComponent | PlatformComponentRegistration;

/**
 * High-level runtime facade that coordinates platform components as one unit.
 */
export interface PlatformShell {
  start(): Promise<void>;
  stop(): Promise<void>;
  ready(): Promise<PlatformReadinessReport>;
  health(): Promise<PlatformHealthReport>;
  snapshot(): Promise<PlatformShellSnapshot>;
}
