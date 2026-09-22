import { Module } from '@fluojs/core';
import { Controller, FromBody, FromPath, Get, NotFoundException, Post, RequestDto } from '@fluojs/http';
import { HealthModule } from '@fluojs/runtime';
import { MinLength } from '@fluojs/validation';

/**
 * The runnable application from the "Controllers" documentation page
 * (apps/docs/content/docs/overview/controllers.mdx), shared by the page's
 * request-level and bootstrap fixtures.
 */

export interface PostRecord {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

export class FindPostParamsDto {
  @FromPath('id')
  id = '';
}

export class CreatePostDto {
  @FromBody()
  @MinLength(3)
  title = '';

  @FromBody()
  content = '';
}

@Controller('/posts')
export class PostsController {
  private readonly posts: PostRecord[] = [
    { id: '1', title: 'Hello, Fluo!', content: 'My first post.' },
  ];

  @Get()
  list(): readonly PostRecord[] {
    return [...this.posts];
  }

  @Get('/:id')
  @RequestDto(FindPostParamsDto)
  get(input: FindPostParamsDto): PostRecord {
    const post = this.posts.find((candidate) => candidate.id === input.id);
    if (!post) {
      throw new NotFoundException(`Post ${input.id} was not found.`);
    }
    return post;
  }

  @Post()
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto): PostRecord {
    const post: PostRecord = { id: '2', title: input.title, content: input.content };
    this.posts.push(post);
    return post;
  }
}

@Module({
  imports: [HealthModule.forRoot()],
  controllers: [PostsController],
})
export class AppModule {}
