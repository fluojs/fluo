import { publicToken } from '@fluojs/core';

/**
 * Contract published by PostsModule. Consumers inject POSTS_READER without
 * importing the implementing class (see packages/core guide example).
 */
export interface PostsReader {
  list(): readonly string[];
}

export const POSTS_READER = publicToken<PostsReader>('my-blog/posts/v1');
