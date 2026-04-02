import type { MaybePromise } from '@konekti/core';
import type {
  PlatformComponent,
  PlatformDiagnosticIssue,
  PlatformSnapshot,
  PlatformState,
  PlatformValidationResult,
} from '@konekti/runtime';

export interface PlatformConformanceScenario {
  createComponent: () => PlatformComponent;
  enterState: (component: PlatformComponent) => MaybePromise<void>;
  name: string;
  expectedState?: PlatformState;
}

export interface PlatformConformanceDiagnosticsOptions {
  collect?: (
    component: PlatformComponent,
    validation: PlatformValidationResult,
  ) => MaybePromise<readonly PlatformDiagnosticIssue[]>;
  expectedCodes?: readonly string[];
  requireFixHintForSeverities?: ReadonlyArray<PlatformDiagnosticIssue['severity']>;
}

export interface PlatformConformanceSnapshotOptions {
  allowKeyPatterns?: readonly RegExp[];
  compare?: (left: unknown, right: unknown) => boolean;
  forbiddenKeyPatterns?: readonly RegExp[];
  sanitize?: (snapshot: PlatformSnapshot) => PlatformSnapshot;
}

export interface PlatformConformanceHarnessOptions {
  captureValidationSideEffects?: (component: PlatformComponent) => MaybePromise<unknown>;
  createComponent: () => PlatformComponent;
  diagnostics?: PlatformConformanceDiagnosticsOptions;
  scenarios?: {
    degraded: PlatformConformanceScenario;
    failed: PlatformConformanceScenario;
  };
  snapshot?: PlatformConformanceSnapshotOptions;
}

const DEFAULT_FORBIDDEN_KEY_PATTERNS = [/secret/i, /password/i, /token/i, /credential/i, /api[-_]?key/i];
const DEFAULT_REQUIRED_FIX_HINT_SEVERITIES: ReadonlyArray<PlatformDiagnosticIssue['severity']> = ['error'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForComparison(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const normalizedEntries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, normalizeForComparison(entry)]);

  return Object.fromEntries(normalizedEntries);
}

function defaultCompare(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function captureOutcome(action: () => Promise<void>): Promise<{ ok: true } | { message: string; ok: false }> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return {
      message: toErrorMessage(error),
      ok: false,
    };
  }
}

function collectForbiddenKeyPaths(
  value: unknown,
  patterns: readonly RegExp[],
  allowPatterns: readonly RegExp[],
  currentPath: string,
  violations: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenKeyPaths(entry, patterns, allowPatterns, `${currentPath}[${index}]`, violations));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = currentPath.length > 0 ? `${currentPath}.${key}` : key;
    const isForbidden = patterns.some((pattern) => pattern.test(key));
    const isAllowed = allowPatterns.some((pattern) => pattern.test(nextPath));

    if (isForbidden && !isAllowed) {
      violations.push(nextPath);
    }

    collectForbiddenKeyPaths(entry, patterns, allowPatterns, nextPath, violations);
  }
}

export class PlatformConformanceHarness {
  constructor(private readonly options: PlatformConformanceHarnessOptions) {}

  async assertValidationHasNoLongLivedSideEffects(): Promise<void> {
    const component = this.options.createComponent();
    const beforeState = component.state();
    const beforeEffects = this.options.captureValidationSideEffects
      ? await this.options.captureValidationSideEffects(component)
      : undefined;

    await component.validate();

    const afterState = component.state();
    if (beforeState !== afterState) {
      throw new Error(
        `validate() must not transition component state. Expected "${beforeState}" but received "${afterState}".`,
      );
    }

    if (!this.options.captureValidationSideEffects) {
      return;
    }

    const compare = this.options.snapshot?.compare ?? defaultCompare;
    const afterEffects = await this.options.captureValidationSideEffects(component);

    if (!compare(beforeEffects, afterEffects)) {
      throw new Error('validate() introduced long-lived side effects.');
    }
  }

  async assertStartIsDeterministic(): Promise<void> {
    const component = this.options.createComponent();
    const compare = this.options.snapshot?.compare ?? defaultCompare;

    const firstStart = await captureOutcome(() => component.start());
    const firstSnapshot = component.snapshot();
    const secondStart = await captureOutcome(() => component.start());
    const secondSnapshot = component.snapshot();

    if (firstStart.ok !== secondStart.ok) {
      throw new Error('start() is not deterministic: first and second calls had different outcomes.');
    }

    if (!firstStart.ok && !secondStart.ok && firstStart.message !== secondStart.message) {
      throw new Error('start() rejection messages changed across duplicate calls.');
    }

    if (firstStart.ok && secondStart.ok && !compare(firstSnapshot, secondSnapshot)) {
      throw new Error('start() is not idempotent: duplicate calls changed component snapshot output.');
    }

    await captureOutcome(() => component.stop());
  }

  async assertStopIsIdempotent(): Promise<void> {
    const component = this.options.createComponent();
    const compare = this.options.snapshot?.compare ?? defaultCompare;

    const startOutcome = await captureOutcome(() => component.start());
    if (!startOutcome.ok) {
      throw new Error(`stop() idempotency check requires a startable component: ${startOutcome.message}`);
    }

    const firstStop = await captureOutcome(() => component.stop());
    if (!firstStop.ok) {
      throw new Error(`first stop() call failed: ${firstStop.message}`);
    }

    const firstState = component.state();
    const firstSnapshot = component.snapshot();

    const secondStop = await captureOutcome(() => component.stop());
    if (!secondStop.ok) {
      throw new Error(`stop() is not idempotent: second call failed with "${secondStop.message}".`);
    }

    const secondState = component.state();
    const secondSnapshot = component.snapshot();

    if (firstState !== secondState) {
      throw new Error(`stop() changed state across duplicate calls (${firstState} -> ${secondState}).`);
    }

    if (!compare(firstSnapshot, secondSnapshot)) {
      throw new Error('stop() is not idempotent: duplicate calls changed component snapshot output.');
    }
  }

  async assertSnapshotSafeInDegradedAndFailedStates(): Promise<void> {
    const scenarios = this.options.scenarios;

    if (!scenarios) {
      throw new Error('Conformance scenarios are required. Provide degraded and failed snapshot scenarios.');
    }

    for (const scenario of [scenarios.degraded, scenarios.failed]) {
      const component = scenario.createComponent();
      await scenario.enterState(component);

      if (scenario.expectedState !== undefined && component.state() !== scenario.expectedState) {
        throw new Error(
          `Scenario "${scenario.name}" expected state "${scenario.expectedState}" but received "${component.state()}".`,
        );
      }

      try {
        component.snapshot();
      } catch (error) {
        throw new Error(`snapshot() must be safe in "${scenario.name}" state: ${toErrorMessage(error)}`);
      } finally {
        await captureOutcome(() => component.stop());
      }
    }
  }

  async assertStableDiagnostics(): Promise<void> {
    const component = this.options.createComponent();
    const validation = await component.validate();
    const diagnostics: PlatformDiagnosticIssue[] = [...validation.issues, ...(validation.warnings ?? [])];

    if (this.options.diagnostics?.collect) {
      const extra = await this.options.diagnostics.collect(component, validation);
      diagnostics.push(...extra);
    }

    const requiredFixHintSeverities =
      this.options.diagnostics?.requireFixHintForSeverities ?? DEFAULT_REQUIRED_FIX_HINT_SEVERITIES;

    for (const issue of diagnostics) {
      if (issue.code.trim().length === 0) {
        throw new Error('Diagnostics must provide a stable non-empty code.');
      }

      if (requiredFixHintSeverities.includes(issue.severity) && (!issue.fixHint || issue.fixHint.trim().length === 0)) {
        throw new Error(`Diagnostic ${issue.code} (${issue.severity}) must provide a fixHint.`);
      }
    }

    const expectedCodes = this.options.diagnostics?.expectedCodes;
    if (!expectedCodes) {
      return;
    }

    const normalizeCodes = (codes: readonly string[]): string[] => [...new Set(codes)].sort();
    const actualCodes = normalizeCodes(diagnostics.map((diagnostic) => diagnostic.code));
    const normalizedExpectedCodes = normalizeCodes(expectedCodes);

    if (!defaultCompare(actualCodes, normalizedExpectedCodes)) {
      throw new Error(
        `Diagnostic code set changed. Expected [${normalizedExpectedCodes.join(', ')}] but received [${actualCodes.join(', ')}].`,
      );
    }
  }

  async assertSnapshotSanitized(): Promise<void> {
    const component = this.options.createComponent();
    const snapshot = component.snapshot();
    const sanitize = this.options.snapshot?.sanitize;
    const candidate = sanitize ? sanitize(snapshot) : snapshot;

    const forbiddenPatterns = this.options.snapshot?.forbiddenKeyPatterns ?? DEFAULT_FORBIDDEN_KEY_PATTERNS;
    const allowPatterns = this.options.snapshot?.allowKeyPatterns ?? [];
    const violations: string[] = [];
    collectForbiddenKeyPaths(candidate, forbiddenPatterns, allowPatterns, '', violations);

    if (violations.length > 0) {
      throw new Error(`snapshot() contains unsanitized keys: ${violations.join(', ')}`);
    }
  }

  async assertAll(): Promise<void> {
    await this.assertValidationHasNoLongLivedSideEffects();
    await this.assertStartIsDeterministic();
    await this.assertStopIsIdempotent();
    await this.assertSnapshotSafeInDegradedAndFailedStates();
    await this.assertStableDiagnostics();
    await this.assertSnapshotSanitized();
  }
}

export function createPlatformConformanceHarness(
  options: PlatformConformanceHarnessOptions,
): PlatformConformanceHarness {
  return new PlatformConformanceHarness(options);
}
