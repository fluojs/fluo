/**
 * Prometheus registry constructor re-exported for applications that want custom
 * application metrics and Fluo framework metrics to share one scrape endpoint.
 *
 * @remarks
 * The implementation is `prom-client`'s `Registry`; duplicate metric names still
 * follow Prometheus registry semantics and fail fast.
 */
export { Registry } from 'prom-client';
export * from './metrics-module.js';
export * from './metrics-service.js';
export * from './providers/meter-provider.js';
export * from './providers/prometheus-meter-provider.js';
export * from './http-metrics-middleware.js';
