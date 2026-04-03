import { exampleJobsTriggeredCounter } from './metrics-registry';

export class OpsMetricsService {
  constructor() {}

  triggerJob() {
    exampleJobsTriggeredCounter.inc();
    return { accepted: true, metric: 'example_ops_jobs_triggered_total' };
  }
}
