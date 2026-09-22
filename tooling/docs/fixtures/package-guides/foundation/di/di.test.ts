import { Inject, Scope } from '@fluojs/core';
import {
  Container,
  type Disposable,
  DuplicateProviderError,
  ForwardRef,
  Optional,
  RequestScopeResolutionError,
  ScopeMismatchError,
} from '@fluojs/di';
import { describe, expect, it, vi } from 'vitest';

/**
 * @fluojs/di guide evidence: the standalone container, provider shapes,
 * overrides, request scopes, and ordered disposal - no module graph involved.
 */

class Logger {
  lines: string[] = [];

  log(message: string): void {
    this.lines.push(message);
  }
}

@Inject(Logger)
class UserService {
  constructor(private readonly logger: Logger) {}

  getStatus(): string {
    this.logger.log('status checked');
    return 'active';
  }
}

describe('@fluojs/di guide examples', () => {
  it('resolves class providers in a standalone container and disposes cleanly', async () => {
    const container = new Container().register(Logger, UserService);
    try {
      const service = await container.resolve(UserService);
      expect(service.getStatus()).toBe('active');
      expect(await container.resolve(Logger)).toBe(await container.resolve(Logger));
    } finally {
      await container.dispose();
    }
  });

  it('rejects duplicate registration; override is the replacement API', async () => {
    const container = new Container().register(Logger);
    expect(() => container.register(Logger)).toThrow(DuplicateProviderError);

    const replacement = new Logger();
    container.override({ provide: Logger, useValue: replacement });

    expect(await container.resolve(Logger)).toBe(replacement);
    await container.dispose();
  });

  it('disposes stale instances when an override replaces them', async () => {
    class Pool {
      disposed = false;

      onDestroy(): void {
        this.disposed = true;
      }
    }

    const container = new Container().register(Pool);
    const original = await container.resolve(Pool);
    expect(original.disposed).toBe(false);

    container.override({ provide: Pool, useValue: { disposed: false } });
    await container.resolve(Pool);

    expect(original.disposed).toBe(true);
    await container.dispose();
  });

  it('returns multi-provider contributions in registration order', async () => {
    const RENDERERS = Symbol('RENDERERS');

    class MarkdownRenderer {
      render(): string {
        return '**md**';
      }
    }

    class PlainTextRenderer {
      render(): string {
        return 'text';
      }
    }

    const container = new Container().register(
      { provide: RENDERERS, useClass: MarkdownRenderer, multi: true },
      { provide: RENDERERS, useClass: PlainTextRenderer, multi: true },
    );
    try {
      const renderers = await container.resolve<{ render(): string }[]>(RENDERERS);
      expect(renderers.map((renderer) => renderer.render())).toEqual(['**md**', 'text']);
    } finally {
      await container.dispose();
    }
  });

  it('keeps request-scoped providers out of the root container', async () => {
    @Scope('request')
    class RequestContextState {
      requestId = 'req-1';
    }

    const container = new Container().register(RequestContextState);
    expect(container.hasRequestScopedDependency(RequestContextState)).toBe(true);
    await expect(container.resolve(RequestContextState)).rejects.toBeInstanceOf(RequestScopeResolutionError);

    const scope = container.createRequestScope();
    try {
      const state = await scope.resolve(RequestContextState);
      expect(state.requestId).toBe('req-1');
    } finally {
      await scope.dispose();
    }
  });

  it('fails singleton-depends-on-request with ScopeMismatchError before construction', async () => {
    @Scope('request')
    class UnitOfWork {}

    @Inject(UnitOfWork)
    class Handler {
      constructor(public readonly unitOfWork: UnitOfWork) {}
    }

    const container = new Container().register(UnitOfWork, Handler);
    try {
      await expect(container.resolve(Handler)).rejects.toBeInstanceOf(ScopeMismatchError);
    } finally {
      await container.dispose();
    }
  });

  it('supports ForwardRef and Optional token wrappers inside @Inject', async () => {
    class MissingService {}

    // ForwardRef defers the LateService lookup, so it may be declared later;
    // Optional needs its token at decoration time, so it is declared above.
    @Inject(ForwardRef.create(() => LateService), Optional.create(MissingService))
    class Consumer {
      constructor(
        public readonly late: LateService,
        public readonly missing: MissingService | undefined,
      ) {}
    }

    class LateService {
      value = 'late';
    }

    const container = new Container().register(Consumer, LateService);
    try {
      const consumer = await container.resolve(Consumer);
      expect(consumer.late.value).toBe('late');
      expect(consumer.missing).toBeUndefined();
    } finally {
      await container.dispose();
    }
  });

  it('destroys dependents before dependencies in reverse creation order', async () => {
    const events: string[] = [];

    class Database {
      onDestroy(): void {
        events.push('database');
      }
    }

    @Inject(Database)
    class Repository implements Disposable {
      constructor(public readonly database: Database) {}

      onDestroy(): void {
        events.push('repository');
      }
    }

    const container = new Container().register(Database, Repository);
    await container.resolve(Repository);
    await container.dispose();

    expect(events).toEqual(['repository', 'database']);
  });

  it('retries only failed onDestroy hooks on a later dispose', async () => {
    const failed = vi.fn().mockRejectedValueOnce(new Error('shutdown race'));
    const succeeded = vi.fn();

    class Flaky {
      onDestroy(): Promise<void> {
        return failed();
      }
    }

    class Stable {
      onDestroy(): void {
        succeeded();
      }
    }

    const container = new Container().register(Flaky, Stable);
    await container.resolve(Flaky);
    await container.resolve(Stable);

    await expect(container.dispose()).rejects.toBeInstanceOf(Error);
    expect(succeeded).toHaveBeenCalledTimes(1);

    await container.dispose();
    expect(failed).toHaveBeenCalledTimes(2);
    expect(succeeded).toHaveBeenCalledTimes(1);
    await expect(container.dispose()).resolves.toBeUndefined();
  });
});
