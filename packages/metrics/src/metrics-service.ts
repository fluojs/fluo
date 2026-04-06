import type {
  Registry,
  CounterConfiguration,
  GaugeConfiguration,
  HistogramConfiguration,
} from 'prom-client';

import { createPrometheusCounter, createPrometheusGauge, createPrometheusHistogram } from './providers/prometheus-metrics-factory.js';

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
