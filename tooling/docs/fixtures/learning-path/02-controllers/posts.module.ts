import { Module } from '@fluojs/core';

import { PostsController } from './posts.controller';

@Module({
  controllers: [PostsController],
})
export class PostsModule {}
