import { Inject, Module, Scope } from '@fluojs/core';
import { Container, type Disposable, Optional, ScopeMismatchError } from '@fluojs/di';
import { Get } from '@fluojs/http';
import { FluoFactory, ModuleInjectionMetadataError, ModuleVisibilityError } from '@fluojs/runtime';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

/**
 * Executable fixture for the "Dependency injection" documentation page
 * (apps/docs/content/docs/fundamentals/dependency-injection.mdx).
 *
 * Each test exercises one documented mechanic on the published surface:
 * scopes, module visibility, bootstrap validation, optional tokens, and
 * test-time provider overrides.
 */

class AuditLog {
  entries: string[] = [];
}

@Scope('singleton')
@Inject(AuditLog)
class PostsService implements Disposable {
  disposed = false;

  constructor(private readonly audit: AuditLog) {}

  create(title: string): string {
    this.audit.entries.push(`created: ${title}`);
    return title;
  }

  onDestroy(): void {
    this.disposed = true;
  }
}

@Inject(PostsService)
class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list(): readonly string[] {
    return ['Hello, Fluo!'];
  }

  create(): string {
    return this.posts.create('from a request');
  }
}

@Module({
  controllers: [PostsController],
  providers: [PostsService, AuditLog],
})
class PostsModule {}

@Module({
  imports: [PostsModule],
})
class AppWithPostsModule {}

@Module({
  providers: [PostsService, AuditLog],
})
class PrivatePostsModule {}

@Scope('request')
class RequestState {}

@Inject(RequestState)
class IllegalSingleton {
  constructor(state: RequestState) {
    void state;
  }
}

describe('docs-foundation dependency-injection fixture', () => {
  it('shares one singleton instance across the container', async () => {
    const container = new Container().register(PostsService, AuditLog);

    try {
      const first = await container.resolve(PostsService);
      const second = await container.resolve(PostsService);

      expect(first).toBe(second);
    } finally {
      await container.dispose();
    }
  });

  it('creates a new transient instance for every resolution', async () => {
    @Scope('transient')
    class Generator {}

    const container = new Container().register(Generator);

    try {
      const first = await container.resolve(Generator);
      const second = await container.resolve(Generator);

      expect(first).not.toBe(second);
    } finally {
      await container.dispose();
    }
  });

  it('resolves a controller graph through module registration', async () => {
    const module = await Test.createTestingModule({ rootModule: AppWithPostsModule }).compile();

    try {
      const controller = await module.resolve(PostsController);
      const audit = await module.resolve(AuditLog);

      controller.create();

      expect(audit.entries).toEqual(['created: from a request']);
    } finally {
      await module.container.dispose();
    }
  });

  it('fails bootstrap when a cross-module dependency is not exported', async () => {
    @Inject(PostsService)
    class CommentsService {
      constructor(private readonly posts: PostsService) {}

      firstPostTitle(): string {
        return this.posts.create('from comments');
      }
    }

    const compile = async () => {
      @Module({
        imports: [PrivatePostsModule],
        providers: [CommentsService],
      })
      class BrokenAppModule {}

      await Test.createTestingModule({ rootModule: BrokenAppModule }).compile();
    };

    await expect(compile()).rejects.toThrow(ModuleVisibilityError);
  });

  it('fails bootstrap when a required constructor parameter has no @Inject token', async () => {
    class UndeclaredDependency {}

    class NoTokenConsumer {
      constructor(dependency: UndeclaredDependency) {
        void dependency;
      }
    }

    const compile = async () => {
      @Module({
        providers: [UndeclaredDependency, NoTokenConsumer],
      })
      class MissingMetadataModule {}

      await Test.createTestingModule({ rootModule: MissingMetadataModule }).compile();
    };

    await expect(compile()).rejects.toThrow(ModuleInjectionMetadataError);
  });

  it('rejects a singleton that depends on a request-scoped provider', async () => {
    const container = new Container().register(IllegalSingleton, RequestState);

    try {
      await expect(container.resolve(IllegalSingleton)).rejects.toThrow(ScopeMismatchError);
    } finally {
      await container.dispose();
    }
  });

  it('resolves a missing optional dependency as undefined', async () => {
    class TelemetrySink {}

    @Inject(Optional.create(TelemetrySink))
    class DiagnosticsRecorder {
      constructor(private readonly telemetry: TelemetrySink | undefined) {}

      isEnabled(): boolean {
        return this.telemetry !== undefined;
      }
    }

    const container = new Container().register(DiagnosticsRecorder);

    try {
      const recorder = await container.resolve(DiagnosticsRecorder);

      expect(recorder.isEnabled()).toBe(false);
    } finally {
      await container.dispose();
    }
  });

  it('replaces a provider through override before compilation', async () => {
    const audit: AuditLog = { entries: [] };
    const module = await Test.createTestingModule({ rootModule: AppWithPostsModule })
      .overrideProvider(AuditLog)
      .useValue(audit)
      .compile();

    try {
      const posts = await module.resolve(PostsService);
      posts.create('from a test');

      expect(audit.entries).toEqual(['created: from a test']);
    } finally {
      await module.container.dispose();
    }
  });

  it('disposes resolved lifecycle instances on container disposal', async () => {
    const module = await Test.createTestingModule({ rootModule: AppWithPostsModule }).compile();

    const posts = await module.resolve(PostsService);
    expect(posts.disposed).toBe(false);

    await module.container.dispose();

    expect(posts.disposed).toBe(true);
  });

  it('runs the same graph as a standalone application context', async () => {
    const context = await FluoFactory.createApplicationContext(AppWithPostsModule);

    try {
      const controller = await context.get(PostsController);

      expect(controller.list()).toEqual(['Hello, Fluo!']);
    } finally {
      await context.close();
    }
  });
});
