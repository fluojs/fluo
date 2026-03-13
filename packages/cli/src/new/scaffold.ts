import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { generateRepoFiles } from '../generators/repo';
import { createTierNote } from './prompt';
import { installDependencies } from './install';
import type { CreateKonektiOptions, PackageManager } from './types';

const PACKAGE_DIRECTORY_BY_NAME = {
  '@konekti/cli': 'cli',
  '@konekti/config': 'config',
  '@konekti/core': 'core',
  '@konekti/di': 'di',
  '@konekti/drizzle': 'drizzle',
  '@konekti/http': 'http',
  '@konekti/jwt': 'jwt',
  '@konekti/passport': 'passport',
  '@konekti/prisma': 'prisma',
  '@konekti/runtime': 'module',
  '@konekti/testing': 'testing',
} as const;

const PUBLISHED_DEV_DEPENDENCIES = {
  '@babel/cli': '^7.26.4',
  '@babel/core': '^7.26.10',
  '@babel/plugin-proposal-decorators': '^7.28.0',
  '@babel/preset-typescript': '^7.27.1',
  '@types/babel__core': '^7.20.5',
  '@types/node': '^22.13.10',
  tsx: '^4.20.4',
  typescript: '^5.8.2',
  vite: '^6.2.1',
  vitest: '^3.0.8',
} as const;

function packageRootFromImportMeta(importMetaUrl: string): string {
  return resolve(dirname(fileURLToPath(importMetaUrl)), '..', '..');
}

function readOwnPackageVersion(importMetaUrl: string): string {
  const packageJson = JSON.parse(readFileSync(join(packageRootFromImportMeta(importMetaUrl), 'package.json'), 'utf8')) as {
    version: string;
  };

  return packageJson.version;
}

function writeTextFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function createDependencySpec(
  packageName: keyof typeof PACKAGE_DIRECTORY_BY_NAME,
  releaseVersion: string,
  packageSpecs: Record<string, string>,
): string {
  return packageSpecs[packageName] ?? `^${releaseVersion}`;
}

function createRunCommand(packageManager: PackageManager, command: string): string {
  switch (packageManager) {
    case 'npm':
      return `npm run ${command}`;
    case 'yarn':
      return `yarn ${command}`;
    default:
      return `pnpm ${command}`;
  }
}

function createExecCommand(packageManager: PackageManager, command: string): string {
  switch (packageManager) {
    case 'npm':
      return `npm exec -- ${command}`;
    case 'yarn':
      return `yarn ${command}`;
    default:
      return `pnpm exec ${command}`;
  }
}

function createProjectPackageJson(
  options: CreateKonektiOptions,
  releaseVersion: string,
  packageSpecs: Record<string, string>,
): string {
  const packageManagerField = options.packageManager === 'pnpm' ? { packageManager: 'pnpm@10.4.1' } : {};
  const localOverrideConfig = Object.keys(packageSpecs).length
    ? {
        overrides: packageSpecs,
        resolutions: packageSpecs,
      }
    : {};

  return JSON.stringify(
    {
      name: options.projectName,
      version: '0.1.0',
      private: true,
      type: 'module',
      engines: {
        node: '>=20.0.0',
      },
      ...packageManagerField,
      ...localOverrideConfig,
      scripts: {
        build: "babel src --extensions .ts --ignore 'src/**/*.test.ts' --out-dir dist --config-file ./babel.config.cjs && tsc -p tsconfig.build.json",
        dev: 'node --env-file=.env.dev --watch --watch-preserve-output --import tsx src/main.ts',
        test: 'vitest run',
        'test:watch': 'vitest',
        typecheck: 'tsc -p tsconfig.json --noEmit',
      },
      dependencies: {
        '@konekti/config': createDependencySpec('@konekti/config', releaseVersion, packageSpecs),
        '@konekti/core': createDependencySpec('@konekti/core', releaseVersion, packageSpecs),
        '@konekti/di': createDependencySpec('@konekti/di', releaseVersion, packageSpecs),
        '@konekti/http': createDependencySpec('@konekti/http', releaseVersion, packageSpecs),
        '@konekti/jwt': createDependencySpec('@konekti/jwt', releaseVersion, packageSpecs),
        '@konekti/passport': createDependencySpec('@konekti/passport', releaseVersion, packageSpecs),
        '@konekti/runtime': createDependencySpec('@konekti/runtime', releaseVersion, packageSpecs),
        '@konekti/testing': createDependencySpec('@konekti/testing', releaseVersion, packageSpecs),
        ...(options.orm === 'Prisma'
          ? { '@konekti/prisma': createDependencySpec('@konekti/prisma', releaseVersion, packageSpecs) }
          : { '@konekti/drizzle': createDependencySpec('@konekti/drizzle', releaseVersion, packageSpecs) }),
      },
      devDependencies: {
        '@konekti/cli': createDependencySpec('@konekti/cli', releaseVersion, packageSpecs),
        ...PUBLISHED_DEV_DEPENDENCIES,
      },
    },
    null,
    2,
  );
}

function createProjectTsconfig(): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
`;
}

function createProjectTsconfigBuild(): string {
  return `{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "emitDeclarationOnly": false,
    "outDir": "dist"
  },
  "exclude": ["src/**/*.test.ts"]
}
`;
}

function createBabelConfig(): string {
  return `module.exports = {
  presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
  plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
};
`;
}

function createDecoratorsPluginFile(): string {
  return `import { transformAsync } from '@babel/core';
import { fileURLToPath } from 'node:url';

const BABEL_CONFIG_FILE = fileURLToPath(new URL('../../babel.config.cjs', import.meta.url));

export function konektiBabelDecoratorsPlugin() {
  return {
    name: 'konekti-babel-decorators',
    async transform(code: string, id: string) {
      if (!id.endsWith('.ts') || id.includes('/node_modules/')) {
        return null;
      }

      const result = await transformAsync(code, {
        babelrc: false,
        configFile: BABEL_CONFIG_FILE,
        filename: id,
        sourceMaps: true,
      });

      if (!result?.code) {
        return null;
      }

      return {
        code: result.code,
        map: result.map ?? null,
      };
    },
  };
}
`;
}

function createVitestConfig(): string {
  return `import { defineConfig } from 'vitest/config';

import { konektiBabelDecoratorsPlugin } from './src/config/konekti-babel-decorators-plugin';

export default defineConfig({
  plugins: [konektiBabelDecoratorsPlugin()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
`;
}

function createGitignore(): string {
  return `node_modules
dist
.konekti
.env.local
coverage
`;
}

function createProjectReadme(options: CreateKonektiOptions): string {
  return `# ${options.projectName}

Generated by @konekti/cli.

- ORM: ${options.orm}
- Database: ${options.database}
- CORS: configurable through CORS_ORIGIN and scaffolded middleware
- Tx-aware repository example: src/examples/user.repo.ts
- Runtime path: bootstrapApplication -> handler mapping -> dispatcher -> middleware -> guard -> interceptor -> controller

## Commands

- Dev: ${createRunCommand(options.packageManager, 'dev')}
- Build: ${createRunCommand(options.packageManager, 'build')}
- Typecheck: ${createRunCommand(options.packageManager, 'typecheck')}
- Test: ${createRunCommand(options.packageManager, 'test')}

## Generator example

- Repo generator: ${createExecCommand(options.packageManager, 'konekti g repo User')}

${createTierNote(options.orm, options.database)}
`;
}

function createNodeAdapterFile(): string {
  return `import { createServer } from 'node:http';
import { URL } from 'node:url';

import type { Dispatcher, FrameworkRequest, FrameworkResponse, HttpApplicationAdapter } from '@konekti/http';

function createFrameworkResponse(response: import('node:http').ServerResponse): FrameworkResponse {
  return {
    committed: response.headersSent || response.writableEnded,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      void this.send(undefined);
    },
    send(body) {
      if (response.writableEnded) {
        this.committed = true;
        return;
      }

      if (!response.hasHeader('Content-Type')) {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
      }

      response.end(body === undefined ? '' : JSON.stringify(body));
      this.committed = true;
    },
    setHeader(name, value) {
      response.setHeader(name, value);
      this.headers[name] = value;
    },
    setStatus(code) {
      response.statusCode = code;
    },
    statusCode: 200,
  };
}

function createFrameworkRequest(request: import('node:http').IncomingMessage): FrameworkRequest {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]),
  );

  return {
    body: undefined,
    cookies: {},
    headers,
    method: request.method ?? 'GET',
    params: {},
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    raw: request,
    url: url.pathname + url.search,
  };
}

export class NodeHttpAdapter implements HttpApplicationAdapter {
  private server?: import('node:http').Server;
  private readonly retryDelayMs = 150;
  private readonly retryLimit = 20;

  constructor(private readonly port: number) {}

  async listen(dispatcher: Dispatcher): Promise<void> {
    this.server = createServer(async (request, response) => {
      const frameworkRequest = createFrameworkRequest(request);
      const frameworkResponse = createFrameworkResponse(response);

      await dispatcher.dispatch(frameworkRequest, frameworkResponse);

      if (!frameworkResponse.committed) {
        frameworkResponse.send(undefined);
      }
    });

    const server = this.server;

    if (!server) {
      throw new Error('Adapter server was not created before listen().');
    }

    await new Promise<void>((resolve, reject) => {
      const tryListen = (attempt: number) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off('listening', onListening);

          if (error.code === 'EADDRINUSE' && attempt < this.retryLimit) {
            setTimeout(() => {
              tryListen(attempt + 1);
            }, this.retryDelayMs);
            return;
          }

          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(this.port);
      };

      tryListen(0);
    });
  }

  async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}
`;
}

function createAppFile(projectName: string): string {
  return `import { fileURLToPath } from 'node:url';

import { Global, Inject, Module } from '@konekti/core';
import { Controller, Get, createCorsMiddleware, type GuardContext } from '@konekti/http';
import { DefaultJwtVerifier, JwtExpiredTokenError, JwtInvalidTokenError, createJwtCoreProviders } from '@konekti/jwt';
import {
  AuthenticationExpiredError,
  AuthenticationFailedError,
  AuthenticationRequiredError,
  RequireScopes,
  UseAuth,
  createPassportProviders,
  type AuthStrategy,
} from '@konekti/passport';
import { KonektiFactory, type ApplicationLogger, type CreateApplicationOptions } from '@konekti/runtime';

import { HealthResponseDto } from './dto/health.dto';
import { HealthRepo } from './health.repo';
import { HealthService } from './health.service';
import { NodeHttpAdapter } from './node-http-adapter';

function extractBearerToken(value: string | string[] | undefined): string | undefined {
  const authorization = Array.isArray(value) ? value[0] : value;

  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return undefined;
  }

  return token;
}

@Inject([DefaultJwtVerifier])
class LocalJwtStrategy implements AuthStrategy {
  constructor(private readonly verifier: DefaultJwtVerifier) {}

  async authenticate(context: GuardContext) {
    const token = extractBearerToken(context.requestContext.request.headers.authorization);

    if (!token) {
      throw new AuthenticationRequiredError();
    }

    try {
      return await this.verifier.verifyAccessToken(token);
    } catch (error) {
      if (error instanceof JwtExpiredTokenError) {
        throw new AuthenticationExpiredError();
      }

      if (error instanceof JwtInvalidTokenError) {
        throw new AuthenticationFailedError();
      }

      throw error;
    }
  }
}

@Inject([HealthService])
@Controller('/health')
class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('/')
  getHealth(): HealthResponseDto {
    return this.healthService.getHealth();
  }

  @Get('/profile')
  @RequireScopes('profile:read')
  @UseAuth('jwt')
  getProfile(_input: unknown, context: { principal?: { subject: string } }) {
    return { subject: context.principal?.subject };
  }
}

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    HealthRepo,
    HealthService,
    ...createJwtCoreProviders({
      algorithms: ['HS256'],
      audience: '${projectName}',
      issuer: '${projectName}',
      secret: process.env.JWT_SECRET ?? 'starter-secret',
    }),
    LocalJwtStrategy,
    ...createPassportProviders(
      {
        defaultStrategy: 'jwt',
      },
      [{ name: 'jwt', token: LocalJwtStrategy }],
    ),
  ],
})
export class AppModule {}

export const appDefaults = (
  mode: 'dev' | 'prod' | 'test',
  adapter?: NodeHttpAdapter,
  logger?: ApplicationLogger,
): CreateApplicationOptions => {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const corsOrigin = process.env.CORS_ORIGIN ?? '*';

  return {
    adapter,
    cwd,
    logger,
    middleware: [
      createCorsMiddleware({
        allowHeaders: ['Authorization', 'Content-Type'],
        allowOrigin: corsOrigin === '*' ? '*' : corsOrigin.split(',').map((value) => value.trim()).filter(Boolean),
        exposeHeaders: ['X-Request-Id'],
      }),
    ],
    mode,
  };
};

export async function createApp(
  mode: 'dev' | 'prod' | 'test',
  adapter?: NodeHttpAdapter,
  logger?: ApplicationLogger,
) {
  return KonektiFactory.create(AppModule, appDefaults(mode, adapter, logger));
}
`;
}

function createHealthRepoFile(projectName: string): string {
  return `import type { HealthResponseDto } from './dto/health.dto';

export class HealthRepo {
  findHealth(): HealthResponseDto {
    return {
      ok: true,
      service: '${projectName}',
    };
  }
}
`;
}

function createHealthServiceFile(): string {
  return `import { Inject } from '@konekti/core';
import type { HealthResponseDto } from './dto/health.dto';

import { HealthRepo } from './health.repo';

@Inject([HealthRepo])
export class HealthService {
  constructor(private readonly healthRepo: HealthRepo) {}

  getHealth(): HealthResponseDto {
    return this.healthRepo.findHealth();
  }
}
`;
}

function createHealthDtoFile(): string {
  return `export class HealthResponseDto {
  ok!: boolean;
  service!: string;
}
`;
}

function createOrmRepositoryExampleFile(orm: CreateKonektiOptions['orm']): string {
  const files = generateRepoFiles('User', { preset: orm === 'Prisma' ? 'prisma' : 'drizzle' });
  return files[0]?.content ?? '';
}

function createMainFile(): string {
  return `import { createConsoleApplicationLogger, type Application, KonektiFactory } from '@konekti/runtime';

import { AppModule, appDefaults } from './app';
import { NodeHttpAdapter } from './node-http-adapter';

const port = Number(process.env.PORT ?? 3000);
const logger = createConsoleApplicationLogger();
let app: Application | undefined;

async function shutdown(signal: string) {
  if (!app) {
    process.exit(0);
    return;
  }

  try {
    await app.close(signal);
    process.exit(0);
  } catch (error) {
    logger.error('Failed to shut down the application cleanly.', error, 'KonektiFactory');
    process.exit(1);
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  app = await KonektiFactory.create(AppModule, appDefaults('dev', new NodeHttpAdapter(port), logger));
  await app.listen();
  logger.log('Listening on http://localhost:' + String(port), 'KonektiFactory');
} catch (error) {
  logger.error('Failed to start application.', error, 'KonektiFactory');

  if (app) {
    await app.close('bootstrap-failed');
  }

  process.exit(1);
}
`;
}

function createAppTestFile(projectName: string): string {
  return `import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { FrameworkRequest, FrameworkResponse } from '@konekti/http';
import { KonektiFactory } from '@konekti/runtime';

import { AppModule, appDefaults } from './app';

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_');
}

function signToken(payload: Record<string, unknown>, secret: string) {
  const headerSegment = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadSegment = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(headerSegment + '.' + payloadSegment)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_');

  return headerSegment + '.' + payloadSegment + '.' + signature;
}

function createRequest(path: string, authorization?: string): FrameworkRequest {
  return {
    body: undefined,
    cookies: {},
    headers: authorization ? { authorization } : {},
    method: 'GET',
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status, location) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body) {
      this.body = body;
      this.committed = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    setStatus(code) {
      this.statusCode = code;
    },
    statusCode: 200,
  };
}

describe('generated app', () => {
  it('dispatches the health route through the runtime path', async () => {
    const app = await KonektiFactory.create(AppModule, appDefaults('test'));
    const response = createResponse();

    await app.dispatch(createRequest('/health'), response);

    expect(response.body).toEqual({ ok: true, service: '${projectName}' });

    await app.close();
  });

  it('stores a verified principal for the protected profile route', async () => {
    const app = await KonektiFactory.create(AppModule, appDefaults('test'));
    const response = createResponse();
    const token = signToken(
      {
        aud: '${projectName}',
        exp: Math.floor(Date.now() / 1000) + 60,
        iss: '${projectName}',
        scope: 'profile:read',
        sub: 'starter-user',
      },
      'starter-secret',
    );

    await app.dispatch(createRequest('/health/profile', 'Bearer ' + token), response);

    expect(response.body).toEqual({ subject: 'starter-user' });

    await app.close();
  });
});
`;
}

function createEnvFile(secret: string): string {
  return `JWT_SECRET=${secret}
CORS_ORIGIN=*
PORT=3000
`;
}

export async function scaffoldKonektiApp(
  options: CreateKonektiOptions,
  importMetaUrl = import.meta.url,
): Promise<void> {
  const targetDirectory = resolve(options.targetDirectory);
  const releaseVersion = readOwnPackageVersion(importMetaUrl);
  const packageSpecs = await resolvePackageSpecs(targetDirectory, options);

  mkdirSync(targetDirectory, { recursive: true });

  writeTextFile(join(targetDirectory, 'package.json'), createProjectPackageJson(options, releaseVersion, packageSpecs));
  writeTextFile(join(targetDirectory, 'README.md'), createProjectReadme(options));
  writeTextFile(join(targetDirectory, 'tsconfig.json'), createProjectTsconfig());
  writeTextFile(join(targetDirectory, 'tsconfig.build.json'), createProjectTsconfigBuild());
  writeTextFile(join(targetDirectory, 'babel.config.cjs'), createBabelConfig());
  writeTextFile(join(targetDirectory, 'vitest.config.ts'), createVitestConfig());
  writeTextFile(join(targetDirectory, '.gitignore'), createGitignore());
  writeTextFile(join(targetDirectory, '.env.dev'), createEnvFile('starter-secret'));
  writeTextFile(join(targetDirectory, '.env.test'), createEnvFile('starter-secret'));
  writeTextFile(join(targetDirectory, '.env.prod'), createEnvFile('starter-secret'));
  writeTextFile(join(targetDirectory, 'src/config/konekti-babel-decorators-plugin.ts'), createDecoratorsPluginFile());
  writeTextFile(join(targetDirectory, 'src/app.ts'), createAppFile(options.projectName));
  writeTextFile(join(targetDirectory, 'src/main.ts'), createMainFile());
  writeTextFile(join(targetDirectory, 'src/node-http-adapter.ts'), createNodeAdapterFile());
  writeTextFile(join(targetDirectory, 'src/health.repo.ts'), createHealthRepoFile(options.projectName));
  writeTextFile(join(targetDirectory, 'src/health.service.ts'), createHealthServiceFile());
  writeTextFile(join(targetDirectory, 'src/dto/health.dto.ts'), createHealthDtoFile());
  writeTextFile(join(targetDirectory, 'src/examples/user.repo.ts'), createOrmRepositoryExampleFile(options.orm));
  writeTextFile(join(targetDirectory, 'src/app.test.ts'), createAppTestFile(options.projectName));

  if (!options.skipInstall) {
    await installDependencies(targetDirectory, options.packageManager);
  }
}

function runPackCommand(repoRoot: string, packageDirectory: string, outputDirectory: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('pnpm', ['pack', '--pack-destination', outputDirectory], {
      cwd: join(repoRoot, 'packages', packageDirectory),
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`Failed to pack ${packageDirectory} with exit code ${code}.`));
    });
  });
}

function expectedTarballName(packageName: string, version: string): string {
  return `${packageName.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

async function resolvePackageSpecs(targetDirectory: string, options: CreateKonektiOptions): Promise<Record<string, string>> {
  if (options.dependencySource !== 'local' || !options.repoRoot) {
    return {};
  }

  const repoRoot = resolve(options.repoRoot);
  const outputDirectory = join(targetDirectory, '.konekti', 'packages');
  mkdirSync(outputDirectory, { recursive: true });

  const packageNames = [
    '@konekti/cli',
    '@konekti/config',
    '@konekti/core',
    '@konekti/di',
    '@konekti/http',
    '@konekti/jwt',
    '@konekti/passport',
    '@konekti/runtime',
    '@konekti/testing',
    options.orm === 'Prisma' ? '@konekti/prisma' : '@konekti/drizzle',
  ] as const;

  for (const packageName of packageNames) {
    await runPackCommand(repoRoot, PACKAGE_DIRECTORY_BY_NAME[packageName], outputDirectory);
  }

  const tarballs = new Map<string, string>();

  for (const packageName of packageNames) {
    const packageDirectory = PACKAGE_DIRECTORY_BY_NAME[packageName];
    const packageVersion = JSON.parse(
      readFileSync(join(repoRoot, 'packages', packageDirectory, 'package.json'), 'utf8'),
    ) as { version: string };
    const tarball = expectedTarballName(packageName, packageVersion.version);

    if (!readdirSync(outputDirectory).includes(tarball)) {
      throw new Error(`Unable to locate packed tarball for ${packageName}.`);
    }

    tarballs.set(packageName, `file:${relative(targetDirectory, join(outputDirectory, tarball))}`);
  }

  return Object.fromEntries(tarballs);
}
