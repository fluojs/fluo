import { Module } from '@fluojs/core';

import { POSTS_READER } from './posts.contract';
import { AuditLog, PostsService } from './posts.service';

@Module({
  providers: [PostsService, AuditLog, { provide: POSTS_READER, useExisting: PostsService }],
  exports: [POSTS_READER],
})
export class PostsModule {}
