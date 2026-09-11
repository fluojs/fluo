import { Test } from '@fluojs/testing';
import { expect, it } from 'vitest';

import { PostsController } from './posts.controller';
import { PostsModule } from './posts.module';
import { PostsService } from './posts.service';

it('injects the registered service when the posts module is compiled', async () => {
  // Given
  const module = await Test.createTestingModule({ rootModule: PostsModule }).compile();
  try {
    const service = await module.resolve(PostsService);
    const controller = await module.resolve(PostsController);

    // When
    const post = controller.get({ id: '1' });

    // Then
    expect(post).toBe(service.get('1'));
  } finally {
    await module.container.dispose();
  }
});
