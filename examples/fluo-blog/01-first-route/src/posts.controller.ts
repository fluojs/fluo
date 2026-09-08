import { Controller, Get } from '@fluojs/http';

import type { Post } from './post';

@Controller('/posts')
export class PostsController {
  @Get()
  list(): readonly Post[] {
    return [{ id: '1', title: 'Hello, Fluo!', content: 'My first post.' }];
  }
}
