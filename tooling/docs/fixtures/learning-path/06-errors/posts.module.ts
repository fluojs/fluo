import { Module } from '@fluojs/core';
import { SerializerInterceptor } from '@fluojs/serialization';

import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService, SerializerInterceptor],
})
export class PostsModule {}
