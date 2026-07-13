import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requirements = [
  ['packages/config/src/module.ts', ['static forRoot(options?: ConfigModuleOptions)', 'global: loadOptions.global ?? true']],
  ['packages/config/src/types.ts', ['processEnv?: NodeJS.ProcessEnv', 'schema?: ConfigSchema', 'global?: boolean']],
  ['docs/getting-started/migrate-from-nestjs.md', ['@nestjs/config', 'ConfigModule.forRoot(...)', 'processEnv', 'Standard Schema', 'global?: boolean', 'FluoFactory.create(AppModule, { adapter })']],
  ['docs/getting-started/migrate-from-nestjs.ko.md', ['@nestjs/config', 'ConfigModule.forRoot(...)', 'processEnv', 'Standard Schema', 'global?: boolean', 'FluoFactory.create(AppModule, { adapter })']],
  ['book/beginner/ch11-config.md', ["import { createFastifyAdapter } from '@fluojs/platform-fastify';", 'adapter: createFastifyAdapter({ port })', 'await app.listen();', 'ConfigModule.forRoot({ processEnv, schema })']],
  ['book/beginner/ch11-config.ko.md', ["import { createFastifyAdapter } from '@fluojs/platform-fastify';", 'adapter: createFastifyAdapter({ port })', 'await app.listen();', 'ConfigModule.forRoot({ processEnv, schema })']],
  ['docs/CONTEXT.md', ['@nestjs/config', 'book/beginner/ch11-config.md', 'ConfigModule.forRoot(...)', 'processEnv', 'adapter-first']],
  ['docs/CONTEXT.ko.md', ['@nestjs/config', 'book/beginner/ch11-config.ko.md', 'ConfigModule.forRoot(...)', 'processEnv', 'adapter-first']],
];

export function enforceConfigNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of requirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Platform consistency governance check failed: ${relativePath} must keep the @nestjs/config migration boundary synchronized; missing: ${missingMarkers.join(', ')}.`,
      );
    }
  }
}
