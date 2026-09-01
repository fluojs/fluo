import { Module } from '@fluojs/core';
import { HealthModule as RuntimeHealthModule } from '@fluojs/runtime';

import { HelloController } from './hello.controller';
import { HelloService } from './hello.service';
import { UploadController } from './upload.controller';

@Module({
  imports: [RuntimeHealthModule.forRoot()],
  controllers: [HelloController, UploadController],
  providers: [HelloService],
})
export class AppModule {}
