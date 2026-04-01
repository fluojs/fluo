import { defineModule } from '@konekti/runtime';

class SharedService {}

export class SharedModule {}
defineModule(SharedModule, {
  exports: [SharedService],
  providers: [SharedService],
});

export class AppModule {}
defineModule(AppModule, {
  imports: [SharedModule],
});
