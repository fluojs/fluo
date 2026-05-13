interface TypeScriptFixtureMetadata {
  readonly source: 'typescript';
}

class TypeScriptSharedService {
  readonly metadata: TypeScriptFixtureMetadata = { source: 'typescript' };
}

/**
 * Represents a TypeScript-authored shared module fixture.
 */
export class TypeScriptSharedModule {}

/**
 * Represents the default TypeScript-authored app module fixture.
 */
export class AppModule {}

/**
 * Represents a named TypeScript-authored module fixture for --export coverage.
 */
export class AdminModule {}

export const inspectFixtureServices = [TypeScriptSharedService];
