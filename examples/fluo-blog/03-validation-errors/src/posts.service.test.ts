import { NotFoundException } from '@fluojs/http';
import { describe, expect, it } from 'vitest';

import { PostsService } from './posts.service';

describe('PostsService', () => {
  it('retains a new post when it is created', () => {
    // Given
    const service = new PostsService();

    // When
    const post = service.create('Learning Fluo', 'Explicit modules and DI.');

    // Then
    expect(post).toEqual({
      id: '2', title: 'Learning Fluo', content: 'Explicit modules and DI.',
    });
    expect(service.get('2')).toBe(post);
    expect(service.list()).toContainEqual(post);
  });

  it('assigns a distinct ID when another post is created', () => {
    // Given
    const service = new PostsService();
    service.create('First added post', 'First content');

    // When
    const post = service.create('Second added post', 'Second content');

    // Then
    expect(post.id).toBe('3');
  });

  it('throws a typed error when a post is absent', () => {
    // Given
    const service = new PostsService();

    // When / Then
    expect(() => service.get('999')).toThrow(NotFoundException);
  });

  it('starts with independent data when a second service is created', () => {
    // Given
    const first = new PostsService();
    first.create('First app only', 'Not shared');

    // When
    const second = new PostsService();

    // Then
    expect(second.list()).toEqual([
      { id: '1', title: 'Hello, Fluo!', content: 'My first post.' },
    ]);
  });
});
