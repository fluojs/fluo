import { Inject } from '@fluojs/core';
import { Controller, Get, HttpCode, Post as PostRoute, RequestDto, UseInterceptors } from '@fluojs/http';
import { SerializerInterceptor } from '@fluojs/serialization';

import { CreatePostDto } from './create-post.dto';
import type { Post } from './post';
import { PostParamsDto } from './post-params.dto';
import { PostResponseDto } from './post-response.dto';
import { PostsService } from './posts.service';

@Controller('/posts')
@UseInterceptors(SerializerInterceptor)
@Inject(PostsService)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  list(): PostResponseDto[] {
    return this.postsService.list().map((post) => this.toResponse(post));
  }

  @Get('/:id')
  @RequestDto(PostParamsDto)
  get(input: PostParamsDto): PostResponseDto {
    return this.toResponse(this.postsService.get(input.id));
  }

  @PostRoute()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto): PostResponseDto {
    return this.toResponse(this.postsService.create(input.title, input.content));
  }

  private toResponse(post: Post): PostResponseDto {
    const response = new PostResponseDto();
    response.id = post.id;
    response.title = post.title;
    response.content = post.content;
    response.internalNotes = post.internalNotes;
    return response;
  }
}
