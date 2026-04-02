import { Module } from '@konekti/core';

import { UsersController } from './users.controller';
import { UsersRepo } from './users.repo';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersRepo, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
