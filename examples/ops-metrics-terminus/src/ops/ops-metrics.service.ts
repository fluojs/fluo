import { Inject } from '@fluojs/core';
import { MetricsService } from '@fluojs/metrics';

const JOBS_TRIGGERED_METRIC = 'example_ops_jobs_triggered_total';

const jobsTriggeredCounters = new WeakMap<
  ReturnType<MetricsService['getRegistry']>,
  ReturnType<MetricsService['counter']>
>();

function getJobsTriggeredCounter(metrics: MetricsService): ReturnType<MetricsService['counter']> {
  const registry = metrics.getRegistry();
  let counter = jobsTriggeredCounters.get(registry);

  if (!counter) {
    counter = metrics.counter({
      help: 'Total number of example ops job trigger requests.',
      name: JOBS_TRIGGERED_METRIC,
    });
    jobsTriggeredCounters.set(registry, counter);
  }

  return counter;
}

@Inject(MetricsService)
export class OpsMetricsService {
  private readonly jobsTriggered: ReturnType<MetricsService['counter']>;

  constructor(metrics: MetricsService) {
    this.jobsTriggered = getJobsTriggeredCounter(metrics);
  }

  triggerJob() {
    this.jobsTriggered.inc();
    return { accepted: true, metric: JOBS_TRIGGERED_METRIC };
  }
}
