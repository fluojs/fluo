/**
 * Low-level Prometheus integration APIs for package authors.
 *
 * @remarks
 * Application modules should use `MetricsModule.forRoot(...)` and inject
 * `MetricsService`. Use this subpath only when an integration must compose
 * a Prometheus registry, meter-provider token, or direct HTTP middleware.
 */
export { Registry } from 'prom-client';
export * from './http-metrics-middleware.js';
export * from './providers/meter-provider.js';
export * from './providers/prometheus-meter-provider.js';
