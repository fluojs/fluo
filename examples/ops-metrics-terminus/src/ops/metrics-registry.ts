import { PrometheusMeterProvider, Registry } from '@konekti/metrics';

export const sharedRegistry = new Registry();
const meter = new PrometheusMeterProvider(sharedRegistry);

export const exampleJobsTriggeredCounter = meter.createCounter(
  'example_ops_jobs_triggered_total',
  'Total number of example ops job trigger requests.',
);
