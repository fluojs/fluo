import { NotFoundException } from '@fluojs/http';

import type { Post } from './post';

export class PostsService {
  // This mutable collection belongs to one application instance, not a database.
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

  create(title: string, content: string): Post {
    const post: Post = { id: String(this.posts.length + 1), title, content };
    this.posts.push(post);
    return post;
  }
}
