import { defineModule } from '@fluojs/runtime';

class SharedService {}

/**
 * Represents the shared module.
 */
export class SharedModule {}
defineModule(SharedModule, {
  exports: [SharedService],
  providers: [SharedService],
});

/**
 * Represents the app module.
 */
export class AppModule {}
defineModule(AppModule, {
  imports: [SharedModule],
});
