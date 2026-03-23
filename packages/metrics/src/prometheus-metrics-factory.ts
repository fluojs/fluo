import {
  Counter,
  Gauge,
  Histogram,
  type CounterConfiguration,
  type GaugeConfiguration,
  type HistogramConfiguration,
  type Registry,
} from 'prom-client';

export function createPrometheusCounter<T extends string = string>(
  registry: Registry,
  config: CounterConfiguration<T>,
): Counter<T> {
  return new Counter({ ...config, registers: [registry] });
}

export function createPrometheusGauge<T extends string = string>(
  registry: Registry,
  config: GaugeConfiguration<T>,
): Gauge<T> {
  return new Gauge({ ...config, registers: [registry] });
}

export function createPrometheusHistogram<T extends string = string>(
  registry: Registry,
  config: HistogramConfiguration<T>,
): Histogram<T> {
  return new Histogram({ ...config, registers: [registry] });
}
