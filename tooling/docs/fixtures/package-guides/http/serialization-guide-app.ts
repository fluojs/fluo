import './metadata-preload';

import { Module } from '@fluojs/core';
import { Controller, Get, UseInterceptors } from '@fluojs/http';
import { Exclude, Expose, SerializerInterceptor, Transform } from '@fluojs/serialization';

/**
 * Runnable application for the Serialization package guide
 * (apps/docs/content/docs/packages/serialization.mdx).
 *
 * Composes @fluojs/serialization with @fluojs/http through SerializerInterceptor:
 * the handler returns real entities (including sensitive fields) and the
 * interceptor shapes the uncommitted response through decorator metadata.
 */

export class UserEntity {
  @Expose()
  id = '';

  @Expose()
  @Transform((value) => String(value).toUpperCase())
  username = '';

  @Expose()
  role = 'member';

  @Exclude()
  passwordHash = '';
}

@Controller('/users')
@UseInterceptors(SerializerInterceptor)
export class SerializationUsersController {
  @Get()
  list(): UserEntity[] {
    const user = new UserEntity();
    user.id = '1';
    user.username = 'fluo';
    user.passwordHash = '$2b$10$not-a-real-hash';

    return [user];
  }
}

@Module({
  controllers: [SerializationUsersController],
  providers: [SerializerInterceptor],
})
export class SerializationAppModule {}
