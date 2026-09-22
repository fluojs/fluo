import { Controller, Get } from '@fluojs/http';

@Controller('/posts')
export class PostsController {
  private readonly posts = [{ id: '1', title: 'Hello Fluo', content: 'First post' }];

  @Get()
  list() {
    return this.posts;
  }
}
