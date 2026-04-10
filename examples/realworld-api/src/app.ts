import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { createHealthModule } from '@fluojs/runtime';

import { UsersModule } from './users/users.module';

const RuntimeHealthModule = createHealthModule();

@Module({
  imports: [ConfigModule.forRoot({ envFile: '.env', processEnv: process.env }), RuntimeHealthModule, UsersModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
