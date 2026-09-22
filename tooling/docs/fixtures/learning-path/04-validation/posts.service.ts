export class PostsService {
  private readonly posts = [{ id: '1', title: 'Hello Fluo', content: 'First post' }];

  private nextId = 2;

  list() {
    return this.posts;
  }

  create(title: string, content: string) {
    const post = { id: String(this.nextId++), title, content };
    this.posts.push(post);
    return post;
  }
}
