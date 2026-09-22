import { Inject, Module } from '@fluojs/core';
import {
  Controller,
  FromBody,
  Get,
  Post,
  type RequestContext,
  RequestDto,
} from '@fluojs/http';
import { HealthModule } from '@fluojs/runtime';
import { MinLength } from '@fluojs/validation';

/**
 * Shared application for the node-platforms package-guide fixtures
 * (apps/docs/content/docs/packages/platform-*.mdx). One AppModule is
 * dispatched through four different HTTP platform adapters: raw Node,
 * Fastify, Express, and the Next.js adapter's Web dispatch surface.
 */

export interface PostRecord {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

export interface RawEcho {
  readonly byteLength: number;
  readonly text: string;
}

export interface UploadEcho {
  readonly mimetype: string;
  readonly name: string;
  readonly size: number;
}

export class CreatePostDto {
  @FromBody()
  @MinLength(3)
  title = '';

  @FromBody()
  content = '';
}

export class PostsService {
  private nextId = 2;
  private readonly posts: PostRecord[] = [
    { id: '1', title: 'Hello, Fluo!', content: 'My first post.' },
  ];

  list(): readonly PostRecord[] {
    return [...this.posts];
  }

  create(input: CreatePostDto): PostRecord {
    const post: PostRecord = { id: String(this.nextId), title: input.title, content: input.content };
    this.nextId += 1;
    this.posts.push(post);
    return post;
  }
}

export const SEED_POST: PostRecord = { id: '1', title: 'Hello, Fluo!', content: 'My first post.' };

@Inject(PostsService)
@Controller('/posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list(): readonly PostRecord[] {
    return this.posts.list();
  }

  @Post()
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto): PostRecord {
    return this.posts.create(input);
  }

  /**
   * Adapter raw-body seam: requires the adapter-level `rawBody: true` option;
   * used by the Fastify guide fixture to verify byte-exact replay.
   */
  @Post('/raw')
  rawEcho(_input: undefined, context: RequestContext): RawEcho {
    const raw = context.request.rawBody;
    return {
      byteLength: raw?.byteLength ?? 0,
      text: raw === undefined ? '' : new TextDecoder().decode(raw),
    };
  }

  /**
   * Buffered multipart seam: adapter-provided files on the runtime-neutral
   * `context.request.files` field.
   */
  @Post('/upload')
  uploadEcho(_input: undefined, context: RequestContext): UploadEcho {
    const file = context.request.files?.[0];
    if (file === undefined) {
      throw new Error('Upload echo requires exactly one file part.');
    }
    return { mimetype: file.mimetype, name: file.originalname, size: file.size };
  }
}

@Module({
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}

@Module({
  imports: [HealthModule.forRoot(), PostsModule],
})
export class AppModule {}
