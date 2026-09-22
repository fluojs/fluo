export class PostsService {
  private readonly posts = [{ id: '1', title: 'Hello Fluo', content: 'First post' }];

  list() {
    return this.posts;
  }
}
