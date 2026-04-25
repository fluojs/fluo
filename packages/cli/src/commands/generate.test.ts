import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runGenerateCommand } from './generate.js';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('runGenerateCommand', () => {
  it('rejects empty resource names', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    expect(() => runGenerateCommand('service', '   ', workspaceDirectory)).toThrow('name must not be empty');
  });

  it('rejects traversal-style resource names', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    expect(() => runGenerateCommand('service', '../User', workspaceDirectory)).toThrow('path separators or traversal sequences');
  });

  it('updates existing module metadata and imports without duplication', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const domainDirectory = join(sourceDirectory, 'posts');
    const modulePath = join(domainDirectory, 'post.module.ts');
    mkdirSync(domainDirectory, { recursive: true });

    writeFileSync(modulePath, `import { Module } from '@fluojs/core';\nimport { ExistingService } from './existing.service';\n\n@Module({ providers:[ExistingService], controllers:[] })\nclass PostModule {}\n\nexport { PostModule };\n`);

    runGenerateCommand('service', 'Post', sourceDirectory);
    runGenerateCommand('service', 'Post', sourceDirectory);

    const moduleContent = readFileSync(modulePath, 'utf8');
    const occurrences = (moduleContent.match(/PostService/g) ?? []).length;

    expect(existsSync(join(domainDirectory, 'post.service.ts'))).toBe(true);
    expect(moduleContent).toContain('ExistingService');
    expect(moduleContent).toContain('PostService');
    expect(moduleContent).toContain('from "./post.service"');
    expect(occurrences).toBe(2);
  });

  it('does not write generated files when module rewrite preflight fails', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const domainDirectory = join(sourceDirectory, 'posts');
    const modulePath = join(domainDirectory, 'post.module.ts');
    mkdirSync(domainDirectory, { recursive: true });

    writeFileSync(
      modulePath,
      `import { Module } from '@fluojs/core';

@Module({ providers: ExistingService })
class PostModule {}

export { PostModule };
`,
      'utf8',
    );

    expect(() => runGenerateCommand('service', 'Post', sourceDirectory)).toThrow('"providers" must be an array');
    expect(existsSync(join(domainDirectory, 'post.service.ts'))).toBe(false);
  });

  it('omits sibling imports when generating standalone controller and service files', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');

    runGenerateCommand('controller', 'Post', sourceDirectory);
    runGenerateCommand('service', 'Audit', sourceDirectory);

    const controllerContent = readFileSync(join(sourceDirectory, 'posts', 'post.controller.ts'), 'utf8');
    const controllerTestContent = readFileSync(join(sourceDirectory, 'posts', 'post.controller.test.ts'), 'utf8');
    const serviceContent = readFileSync(join(sourceDirectory, 'audits', 'audit.service.ts'), 'utf8');
    const serviceTestContent = readFileSync(join(sourceDirectory, 'audits', 'audit.service.test.ts'), 'utf8');

    expect(controllerContent).not.toContain("from './post.service'");
    expect(controllerContent).not.toContain("from '@fluojs/core'");
    expect(controllerContent).toContain('return [];');
    expect(controllerTestContent).toContain('new PostController().listPosts()');
    expect(serviceContent).not.toContain("from './audit.repo'");
    expect(serviceContent).not.toContain("from '@fluojs/core'");
    expect(serviceContent).toContain('return [];');
    expect(serviceTestContent).toContain('new AuditService().listAudits()');
  });

  it('reuses sibling imports when matching service or repo files already exist', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const postDirectory = join(sourceDirectory, 'posts');
    const auditDirectory = join(sourceDirectory, 'audits');
    mkdirSync(postDirectory, { recursive: true });
    mkdirSync(auditDirectory, { recursive: true });

    writeFileSync(join(postDirectory, 'post.service.ts'), 'export class PostService { async listPosts() { return []; } }', 'utf8');
    writeFileSync(join(auditDirectory, 'audit.repo.ts'), 'export class AuditRepo { listAudits() { return []; } }', 'utf8');

    runGenerateCommand('controller', 'Post', sourceDirectory, { force: true });
    runGenerateCommand('service', 'Audit', sourceDirectory, { force: true });

    const controllerContent = readFileSync(join(postDirectory, 'post.controller.ts'), 'utf8');
    const serviceContent = readFileSync(join(auditDirectory, 'audit.service.ts'), 'utf8');

    expect(controllerContent).toContain("from './post.service'");
    expect(controllerContent).toContain('constructor(private readonly service: PostService) {}');
    expect(serviceContent).toContain("from './audit.repo'");
    expect(serviceContent).toContain('constructor(private readonly repo: AuditRepo) {}');
  });

  it('skips rewriting module files when generated content is unchanged', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');

    runGenerateCommand('service', 'Post', sourceDirectory);

    const modulePath = join(sourceDirectory, 'posts', 'post.module.ts');
    const servicePath = join(sourceDirectory, 'posts', 'post.service.ts');
    const oldTimestamp = new Date('2000-01-01T00:00:00.000Z');
    utimesSync(modulePath, oldTimestamp, oldTimestamp);
    utimesSync(servicePath, oldTimestamp, oldTimestamp);

    const result = runGenerateCommand('service', 'Post', sourceDirectory, { force: true });

    expect(result.generatedFiles).toEqual([]);
    expect(result.wiringBehavior).toBe('auto-registered');
    expect(result.moduleRegistered).toBe(true);
    expect(statSync(modulePath).mtimeMs).toBe(oldTimestamp.getTime());
    expect(statSync(servicePath).mtimeMs).toBe(oldTimestamp.getTime());
  });

  it('returns GenerateResult with structured wiring metadata for auto-registered kinds', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const result = runGenerateCommand('controller', 'Order', sourceDirectory);

    expect(result.generatedFiles.length).toBeGreaterThan(0);
    expect(result.wiringBehavior).toBe('auto-registered');
    expect(result.moduleRegistered).toBe(true);
    expect(result.modulePath).toContain('order.module.ts');
    expect(result.nextStepHint).toContain('pnpm typecheck');
  });

  it('returns GenerateResult with files-only wiring metadata for non-registered kinds', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const result = runGenerateCommand('request-dto', 'CreateUser', sourceDirectory);

    expect(result.generatedFiles.length).toBeGreaterThan(0);
    expect(result.wiringBehavior).toBe('files-only');
    expect(result.moduleRegistered).toBe(false);
    expect(result.modulePath).toBeUndefined();
    expect(result.nextStepHint).toContain('@FromBody');
  });

  it('previews auto-registered generation without writing files during dry-run', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const result = runGenerateCommand('service', 'Post', sourceDirectory, { dryRun: true });

    expect(result.generatedFiles).toEqual([]);
    expect(result.plannedFiles).toEqual([
      { action: 'create', path: join(sourceDirectory, 'posts', 'post.service.ts') },
      { action: 'create', path: join(sourceDirectory, 'posts', 'post.service.test.ts') },
      { action: 'module-create', path: join(sourceDirectory, 'posts', 'post.module.ts') },
    ]);
    expect(result.wiringBehavior).toBe('auto-registered');
    expect(result.moduleRegistered).toBe(true);
    expect(existsSync(join(sourceDirectory, 'posts'))).toBe(false);
  });

  it('previews module updates without changing existing module files during dry-run', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const domainDirectory = join(sourceDirectory, 'posts');
    const modulePath = join(domainDirectory, 'post.module.ts');
    const initialModuleContent = `import { Module } from '@fluojs/core';
import { ExistingService } from './existing.service';

@Module({ providers: [ExistingService], controllers: [] })
class PostModule {}

export { PostModule };
`;
    mkdirSync(domainDirectory, { recursive: true });
    writeFileSync(modulePath, initialModuleContent, 'utf8');

    const result = runGenerateCommand('service', 'Post', sourceDirectory, { dryRun: true });

    expect(result.generatedFiles).toEqual([]);
    expect(result.plannedFiles).toEqual([
      { action: 'create', path: join(domainDirectory, 'post.service.ts') },
      { action: 'create', path: join(domainDirectory, 'post.service.test.ts') },
      { action: 'module-update', path: modulePath },
    ]);
    expect(result.wiringBehavior).toBe('auto-registered');
    expect(result.moduleRegistered).toBe(true);
    expect(readFileSync(modulePath, 'utf8')).toBe(initialModuleContent);
    expect(existsSync(join(domainDirectory, 'post.service.ts'))).toBe(false);
    expect(existsSync(join(domainDirectory, 'post.service.test.ts'))).toBe(false);
  });

  it('previews explicit request DTO feature targets without writing files during dry-run', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const result = runGenerateCommand('request-dto', 'CreateUser', sourceDirectory, { dryRun: true, targetFeature: 'users' });

    expect(result.generatedFiles).toEqual([]);
    expect(result.plannedFiles).toEqual([{ action: 'create', path: join(sourceDirectory, 'users', 'create-user.request.dto.ts') }]);
    expect(result.wiringBehavior).toBe('files-only');
    expect(result.moduleRegistered).toBe(false);
    expect(existsSync(join(sourceDirectory, 'users'))).toBe(false);
    expect(existsSync(join(sourceDirectory, 'create-users'))).toBe(false);
  });

  it('previews skip versus force overwrite decisions without changing existing files', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const domainDirectory = join(sourceDirectory, 'posts');
    const servicePath = join(domainDirectory, 'post.service.ts');
    mkdirSync(domainDirectory, { recursive: true });
    writeFileSync(servicePath, 'export class CustomPostService {}\n', 'utf8');

    const skipped = runGenerateCommand('service', 'Post', sourceDirectory, { dryRun: true });
    const overwritten = runGenerateCommand('service', 'Post', sourceDirectory, { dryRun: true, force: true });

    expect(skipped.plannedFiles).toContainEqual({ action: 'skip', path: servicePath });
    expect(overwritten.plannedFiles).toContainEqual({ action: 'overwrite', path: servicePath });
    expect(readFileSync(servicePath, 'utf8')).toBe('export class CustomPostService {}\n');
    expect(existsSync(join(domainDirectory, 'post.module.ts'))).toBe(false);
  });

  it('writes request DTOs into an explicit feature directory when provided', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const result = runGenerateCommand('request-dto', 'CreateUser', sourceDirectory, { targetFeature: 'users' });

    expect(result.generatedFiles).toEqual([join(sourceDirectory, 'users', 'create-user.request.dto.ts')]);
    expect(existsSync(join(sourceDirectory, 'users', 'create-user.request.dto.ts'))).toBe(true);
    expect(existsSync(join(sourceDirectory, 'create-users', 'create-user.request.dto.ts'))).toBe(false);
    expect(result.wiringBehavior).toBe('files-only');
    expect(result.moduleRegistered).toBe(false);
  });

  it('normalizes PascalCase request DTO feature names to plural slice directories', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const result = runGenerateCommand('request-dto', 'CreateUser', sourceDirectory, { targetFeature: 'User' });

    expect(result.generatedFiles).toEqual([join(sourceDirectory, 'users', 'create-user.request.dto.ts')]);
    expect(existsSync(join(sourceDirectory, 'users', 'create-user.request.dto.ts'))).toBe(true);
    expect(existsSync(join(sourceDirectory, 'user', 'create-user.request.dto.ts'))).toBe(false);
  });

  it('validates explicit request DTO feature names before writing files', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');

    expect(() => runGenerateCommand('request-dto', 'CreateUser', sourceDirectory, { targetFeature: '../users' })).toThrow(
      'path separators or traversal sequences',
    );
    expect(() => runGenerateCommand('request-dto', 'CreateUser', sourceDirectory, { targetFeature: '..\\users' })).toThrow(
      'path separators or traversal sequences',
    );
    expect(existsSync(join(sourceDirectory, 'create-users', 'create-user.request.dto.ts'))).toBe(false);
  });

  it('returns GenerateResult with module wiring hint for standalone module kind', () => {
    const workspaceDirectory = mkdtempSync(join(tmpdir(), 'fluo-generate-'));
    tempDirectories.push(workspaceDirectory);

    const sourceDirectory = join(workspaceDirectory, 'src');
    const result = runGenerateCommand('module', 'Auth', sourceDirectory);

    expect(result.generatedFiles.length).toBeGreaterThan(0);
    expect(result.wiringBehavior).toBe('files-only');
    expect(result.moduleRegistered).toBe(false);
    expect(result.nextStepHint).toContain('parent module');
  });
});
