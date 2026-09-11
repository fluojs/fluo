import { Test } from '@fluojs/testing';
import { expect, it } from 'vitest';

import { PostsController } from './posts.controller';
import { PostsModule } from './posts.module';
import { PostsService } from './posts.service';

it('shares the singleton when the controller creates a post', async () => {
  // Given
  const module = await Test.createTestingModule({ rootModule: PostsModule }).compile();
  try {
    const controller = await module.resolve(PostsController);
    const service = await module.resolve(PostsService);

    // When
    const post = controller.create({
      title: 'Module integration', content: 'One registered provider.',
    });

    // Then
    expect(service.get('2')).toBe(post);
    expect(controller.get({ id: '2' })).toBe(post);
  } finally {
    await module.container.dispose();
  }
});
