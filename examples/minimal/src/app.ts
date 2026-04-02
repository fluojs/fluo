import { Module } from '@konekti/core';
import { createHealthModule } from '@konekti/runtime';

import { HelloController } from './hello.controller';
import { HelloService } from './hello.service';

const RuntimeHealthModule = createHealthModule();

@Module({
  imports: [RuntimeHealthModule],
  controllers: [HelloController],
  providers: [HelloService],
})
export class AppModule {}
