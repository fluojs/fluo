export interface MeterCounter {
  inc(labels?: Record<string, string | number>, value?: number): void;
}

export interface MeterGauge {
  set(value: number, labels?: Record<string, string | number>): void;
}

export interface MeterHistogram {
  observe(value: number, labels?: Record<string, string | number>): void;
}

export interface MeterProvider {
  readonly type: 'prometheus' | 'otel' | string;
  createCounter(name: string, help: string, labelNames?: string[]): MeterCounter;
  createGauge(name: string, help: string, labelNames?: string[]): MeterGauge;
  createHistogram(name: string, help: string, labelNames?: string[], buckets?: number[]): MeterHistogram;
}

export const METER_PROVIDER = Symbol.for('konekti.metrics.meter-provider');
