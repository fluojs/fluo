import { Module } from '@fluojs/core';
import { HealthModule } from '@fluojs/runtime';

import { PostsModule } from './posts.module';

@Module({
  imports: [HealthModule.forRoot(), PostsModule],
})
export class AppModule {}
