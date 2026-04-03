import { Module } from '@konekti/core';

import { OpsController } from './ops.controller';
import { OpsMetricsService } from './ops-metrics.service';

@Module({
  controllers: [OpsController],
  providers: [OpsMetricsService],
})
export class OpsModule {}
