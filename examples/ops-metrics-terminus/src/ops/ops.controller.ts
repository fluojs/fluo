import { Inject } from '@konekti/core';
import { Controller, Get } from '@konekti/http';

import { OpsMetricsService } from './ops-metrics.service';

@Inject(OpsMetricsService)
@Controller('/ops')
export class OpsController {
  constructor(private readonly service: OpsMetricsService) {}

  @Get('/jobs/trigger')
  triggerJob() {
    return this.service.triggerJob();
  }
}
