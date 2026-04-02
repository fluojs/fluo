import { Module } from '@konekti/core';
import { ConfigModule } from '@konekti/config';
import { createHealthModule } from '@konekti/runtime';

import { UsersModule } from './users/users.module';

const RuntimeHealthModule = createHealthModule();

@Module({
  imports: [ConfigModule.forRoot({ envFile: '.env' }), RuntimeHealthModule, UsersModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
