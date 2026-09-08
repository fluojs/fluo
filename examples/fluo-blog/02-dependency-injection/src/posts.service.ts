import { NotFoundException } from '@fluojs/http';

import type { Post } from './post';

export class PostsService {
  private readonly posts: Post[] = [
    { id: '1', title: 'Hello, Fluo!', content: 'My first post.' },
  ];

  list(): readonly Post[] {
    return [...this.posts];
  }

  get(id: string): Post {
    const post = this.posts.find((candidate) => candidate.id === id);
    if (!post) {
      throw new NotFoundException(`Post ${id} was not found.`);
    }
    return post;
  }
}
