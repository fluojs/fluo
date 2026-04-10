import { Module } from '@fluojs/core';
import { createHealthModule } from '@fluojs/runtime';

import { AuthModule } from './auth/auth.module';

const RuntimeHealthModule = createHealthModule();

@Module({
  imports: [RuntimeHealthModule, AuthModule],
})
export class AppModule {}
