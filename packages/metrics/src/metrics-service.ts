import type {
  Registry,
  CounterConfiguration,
  GaugeConfiguration,
  HistogramConfiguration,
} from 'prom-client';

import { createPrometheusCounter, createPrometheusGauge, createPrometheusHistogram } from './prometheus-metrics-factory.js';

export const METRICS_SERVICE = Symbol.for('konekti.metrics.service');

export class MetricsService {
  constructor(private readonly registry: Registry) {}

  counter<T extends string = string>(config: CounterConfiguration<T>) {
    return createPrometheusCounter(this.registry, config);
  }

  gauge<T extends string = string>(config: GaugeConfiguration<T>) {
    return createPrometheusGauge(this.registry, config);
  }

  histogram<T extends string = string>(config: HistogramConfiguration<T>) {
    return createPrometheusHistogram(this.registry, config);
  }

  getRegistry(): Registry {
    return this.registry;
  }
}
