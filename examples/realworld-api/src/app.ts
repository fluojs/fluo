import { Module } from '@fluojs/core';
import { ConfigModule } from '@fluojs/config';
import { HealthModule as RuntimeHealthModule } from '@fluojs/runtime';

import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Explicit ordered env files: later entries win, and missing files are skipped.
    ConfigModule.forRoot({ envFilePaths: ['.env', '.env.local'], processEnv: process.env }),
    RuntimeHealthModule.forRoot(),
    UsersModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
