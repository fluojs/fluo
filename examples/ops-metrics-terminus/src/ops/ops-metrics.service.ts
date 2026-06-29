import { Inject } from '@fluojs/core';
import { MetricsService } from '@fluojs/metrics';

const JOBS_TRIGGERED_METRIC = 'example_ops_jobs_triggered_total';

@Inject(MetricsService)
export class OpsMetricsService {
  private readonly jobsTriggered: ReturnType<MetricsService['counter']>;

  constructor(metrics: MetricsService) {
    this.jobsTriggered = metrics.counter({
      help: 'Total number of example ops job trigger requests.',
      name: JOBS_TRIGGERED_METRIC,
    });
  }

  triggerJob() {
    this.jobsTriggered.inc();
    return { accepted: true, metric: JOBS_TRIGGERED_METRIC };
  }
}
