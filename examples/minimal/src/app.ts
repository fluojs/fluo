import { Module } from '@fluojs/core';
import { createHealthModule } from '@fluojs/runtime';

import { HelloController } from './hello.controller';
import { HelloService } from './hello.service';

const RuntimeHealthModule = createHealthModule();

@Module({
  imports: [RuntimeHealthModule],
  controllers: [HelloController],
  providers: [HelloService],
})
export class AppModule {}
