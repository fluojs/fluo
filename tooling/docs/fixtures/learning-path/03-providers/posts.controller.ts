import { Inject } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';

import { PostsService } from './posts.service';

@Controller('/posts')
@Inject(PostsService)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  list() {
    return this.postsService.list();
  }
}
