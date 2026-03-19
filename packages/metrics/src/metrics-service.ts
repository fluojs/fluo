import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  type CounterConfiguration,
  type GaugeConfiguration,
  type HistogramConfiguration,
} from 'prom-client';

export const METRICS_SERVICE = Symbol.for('konekti.metrics.service');

export class MetricsService {
  constructor(private readonly registry: Registry) {}

  counter<T extends string = string>(config: CounterConfiguration<T>): Counter<T> {
    return new Counter({ ...config, registers: [this.registry] });
  }

  gauge<T extends string = string>(config: GaugeConfiguration<T>): Gauge<T> {
    return new Gauge({ ...config, registers: [this.registry] });
  }

  histogram<T extends string = string>(config: HistogramConfiguration<T>): Histogram<T> {
    return new Histogram({ ...config, registers: [this.registry] });
  }

  getRegistry(): Registry {
    return this.registry;
  }
}
