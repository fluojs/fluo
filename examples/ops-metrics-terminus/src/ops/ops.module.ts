import { Module } from '@fluojs/core';

import { opsMetricsModule } from './metrics-registry';
import { OpsController } from './ops.controller';
import { OpsMetricsService } from './ops-metrics.service';

@Module({
  controllers: [OpsController],
  imports: [opsMetricsModule],
  providers: [OpsMetricsService],
})
export class OpsModule {}
