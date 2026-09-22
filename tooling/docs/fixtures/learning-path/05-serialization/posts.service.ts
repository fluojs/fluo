import type { Post } from './post';

export class PostsService {
  private readonly posts: Post[] = [
    { id: '1', title: 'Hello Fluo', content: 'First post', internalNotes: 'seeded record' },
  ];

  private nextId = 2;

  list(): readonly Post[] {
    return this.posts;
  }

  create(title: string, content: string): Post {
    const post: Post = { id: String(this.nextId++), title, content, internalNotes: '' };
    this.posts.push(post);
    return post;
  }
}
