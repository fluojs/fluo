import type { Registry } from 'prom-client';

import type { MeterCounter, MeterGauge, MeterHistogram, MeterProvider } from './meter-provider.js';
import { createPrometheusCounter, createPrometheusGauge, createPrometheusHistogram } from './prometheus-metrics-factory.js';

export class PrometheusMeterProvider implements MeterProvider {
  readonly type = 'prometheus' as const;

  constructor(private readonly registry: Registry) {}

  createCounter(name: string, help: string, labelNames: string[] = []): MeterCounter {
    const counter = createPrometheusCounter(this.registry, {
      help,
      labelNames,
      name,
    });

    return {
      inc(labels?: Record<string, string | number>, value = 1): void {
        if (labels) {
          counter.inc(labels, value);
          return;
        }

        counter.inc(value);
      },
    };
  }

  createGauge(name: string, help: string, labelNames: string[] = []): MeterGauge {
    const gauge = createPrometheusGauge(this.registry, {
      help,
      labelNames,
      name,
    });

    return {
      set(value: number, labels?: Record<string, string | number>): void {
        if (labels) {
          gauge.set(labels, value);
          return;
        }

        gauge.set(value);
      },
    };
  }

  createHistogram(name: string, help: string, labelNames: string[] = [], buckets?: number[]): MeterHistogram {
    const histogram = createPrometheusHistogram(this.registry, {
      buckets,
      help,
      labelNames,
      name,
    });

    return {
      observe(value: number, labels?: Record<string, string | number>): void {
        if (labels) {
          histogram.observe(labels, value);
          return;
        }

        histogram.observe(value);
      },
    };
  }
}
