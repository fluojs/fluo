import { Inject } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';

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
