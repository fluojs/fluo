import { Module } from '@fluojs/core';
import { HealthModule } from '@fluojs/runtime';

import { PostsController } from './posts.controller';

@Module({
  imports: [HealthModule.forRoot()],
  controllers: [PostsController],
})
export class AppModule {}
