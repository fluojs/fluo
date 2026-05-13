import { defineModule } from '@fluojs/runtime';

class TypeScriptSharedService {}

/**
 * Represents a TypeScript-authored shared module fixture.
 */
export class TypeScriptSharedModule {}
defineModule(TypeScriptSharedModule, {
  exports: [TypeScriptSharedService],
  providers: [TypeScriptSharedService],
});

/**
 * Represents the default TypeScript-authored app module fixture.
 */
export class AppModule {}
defineModule(AppModule, {
  imports: [TypeScriptSharedModule],
});

/**
 * Represents a named TypeScript-authored module fixture for --export coverage.
 */
export class AdminModule {}
defineModule(AdminModule, {
  providers: [TypeScriptSharedService],
});
