import { Inject } from '@fluojs/core';
import { Controller, Get, HttpCode, Post as PostRoute, RequestDto } from '@fluojs/http';

import { CreatePostDto } from './create-post.dto';
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

  @PostRoute()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto): Post {
    return this.posts.create(input.title, input.content);
  }
}
