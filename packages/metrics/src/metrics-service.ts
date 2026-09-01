import type {
  Registry,
  CounterConfiguration,
  GaugeConfiguration,
  HistogramConfiguration,
} from 'prom-client';

import { createPrometheusCounter, createPrometheusGauge, createPrometheusHistogram } from './providers/prometheus-metrics-factory.js';

/**
 * Small facade for creating custom Prometheus metrics on its `MetricsModule` registry.
 *
 * @remarks
 * `MetricsService` is module-local: it is injectable only from the module that imports
 * the corresponding `MetricsModule.forRoot(...)` registration. It is not globally
 * available to sibling modules.
 */
export class MetricsService {
  constructor(private readonly registry: Registry) {}

  /**
   * Create a counter on the module registry.
   *
   * @param config Prometheus counter configuration.
   * @returns A counter registered on this module's registry.
   */
  counter<T extends string = string>(config: CounterConfiguration<T>) {
    return createPrometheusCounter(this.registry, config);
  }

  /**
   * Create a gauge on the module registry.
   *
   * @param config Prometheus gauge configuration.
   * @returns A gauge registered on this module's registry.
   */
  gauge<T extends string = string>(config: GaugeConfiguration<T>) {
    return createPrometheusGauge(this.registry, config);
  }

  /**
   * Create a histogram on the module registry.
   *
   * @param config Prometheus histogram configuration.
   * @returns A histogram registered on this module's registry.
   */
  histogram<T extends string = string>(config: HistogramConfiguration<T>) {
    return createPrometheusHistogram(this.registry, config);
  }

  /**
   * Return the underlying Prometheus registry used by the module.
   *
   * @returns The registry backing all framework and custom metrics.
   */
  getRegistry(): Registry {
    return this.registry;
  }
}
