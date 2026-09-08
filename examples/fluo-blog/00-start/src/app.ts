import { Module } from '@fluojs/core';
import { HealthModule } from '@fluojs/runtime';

@Module({
  imports: [HealthModule.forRoot()],
})
export class AppModule {}
