import { writeFileSync } from 'node:fs';
import { LoadProcessFailure } from './load';
import { ResourceMeasurementFailure } from './resources';
import { TrafficFailure } from './traffic';

export function failureEvidence(error: unknown): unknown {
  if (!(error instanceof Error)) return { message: String(error) };
  if (error instanceof TrafficFailure) return { name: error.name, message: error.message, traffic: error.diagnostics };
  if (error instanceof ResourceMeasurementFailure) {
    return { name: error.name, message: error.message, serverSamples: error.samples, cause: failureEvidence(error.cause) };
  }
  if (error instanceof LoadProcessFailure) {
    return { name: error.name, message: error.message, stdout: error.stdout, stderr: error.stderr, cause: failureEvidence(error.cause) };
  }
  return {
    name: error.name, message: error.message,
    ...('code' in error ? { code: error.code } : {}),
    ...('signal' in error ? { signal: error.signal } : {}),
  };
}

export class EvidenceJournal {
  readonly failures: unknown[] = [];
  current: unknown = null;
  private finished = false;
  private readonly onExit = (code: number) => {
    if (this.finished) return;
    this.failures.push({ condition: this.current, phase: 'interrupted', exitCode: code, availableData: 'completed samples and recorded diagnostics only' });
    this.flush();
  };

  constructor(readonly path: string, private readonly snapshot: () => object) {
    process.once('exit', this.onExit);
  }

  fail(error: unknown): void {
    this.failures.push({ condition: this.current, error: failureEvidence(error) });
  }

  async record<T>(condition: unknown, destination: T[], operation: (complete: (value: T) => void) => Promise<void>): Promise<void> {
    this.current = condition;
    try {
      await operation((value) => destination.push(value));
      this.current = null;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  flush(): void {
    writeFileSync(this.path, `${JSON.stringify({ ...this.snapshot(), invalidAttempts: this.failures }, null, 2)}\n`);
  }

  finish(): void {
    this.flush();
    this.finished = true;
    process.removeListener('exit', this.onExit);
  }
}
