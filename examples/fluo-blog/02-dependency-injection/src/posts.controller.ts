import { Inject } from '@fluojs/core';
import { Controller, Get, RequestDto } from '@fluojs/http';

import type { Post } from './post';
import { PostParamsDto } from './post-params.dto';
import { PostsService } from './posts.service';

@Inject(PostsService)
@Controller('/posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list(): readonly Post[] {
    return this.posts.list();
  }

  @Get('/:id')
  @RequestDto(PostParamsDto)
  get(input: PostParamsDto): Post {
    return this.posts.get(input.id);
  }
}
