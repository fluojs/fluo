import { Inject } from '@fluojs/core';
import { Controller, Get, HttpCode, Post as PostRoute, RequestDto } from '@fluojs/http';

import { CreatePostDto } from './create-post.dto';
import { PostsService } from './posts.service';

@Controller('/posts')
@Inject(PostsService)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  list() {
    return this.postsService.list();
  }

  @PostRoute()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return this.postsService.create(input.title, input.content);
  }
}
