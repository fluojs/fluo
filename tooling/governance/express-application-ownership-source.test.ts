import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceExpressApplicationOwnershipDocs } from './express-application-ownership-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const adapterSourcePath = 'packages/platform-express/src/adapter.ts';

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function withAdapterSource(transform: (source: string) => string): (relativePath: string) => string {
  return (relativePath: string): string => {
    const content = read(relativePath);
    return relativePath === adapterSourcePath ? transform(content) : content;
  };
}

describe('Express application ownership source contract', () => {
  it('rejects a direct existing application option', () => {
    const readFixture = withAdapterSource((source) =>
      source.replace('  host?: string;', '  app?: Express;\n  host?: string;'),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /existing Express application adoption options/,
    );
  });

  it('rejects a public use method', () => {
    const readFixture = withAdapterSource((source) =>
      source.replace(
        '  getServer(): ExpressServer {',
        '  use(_middleware: ExpressNativeMiddleware): void {}\n\n  getServer(): ExpressServer {',
      ),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /post-bootstrap native stack mutation surface/,
    );
  });

  it('rejects an existing Express application constructor parameter', () => {
    const readFixture = withAdapterSource((source) =>
      source.replace(
        '    nativeMiddleware: readonly ExpressNativeMiddleware[] = [],',
        '    nativeMiddleware: readonly ExpressNativeMiddleware[] = [],\n    existingApplication?: Express,',
      ),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /constructor.*existing Express application/iu,
    );
  });

  it('rejects inherited existing application options', () => {
    const readFixture = withAdapterSource((source) =>
      source.replace(
        'export interface ExpressAdapterOptions {',
        'interface ExistingApplicationOptions {\n  app: Express;\n}\n\nexport interface ExpressAdapterOptions extends ExistingApplicationOptions {',
      ),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /existing Express application adoption options/,
    );
  });

  it('rejects intersection existing application options', () => {
    const readFixture = withAdapterSource((source) =>
      source.replace(
        'export interface BootstrapExpressApplicationOptions',
        'export type ExistingExpressAdapterOptions = ExpressAdapterOptions & { application: Express };\n\nexport interface BootstrapExpressApplicationOptions',
      ),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /existing Express application adoption options/,
    );
  });

  it('rejects a public function-valued use surface', () => {
    const readFixture = withAdapterSource((source) =>
      source.replace(
        '  getServer(): ExpressServer {',
        '  use = (_middleware: ExpressNativeMiddleware): void => {};\n\n  getServer(): ExpressServer {',
      ),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /post-bootstrap native stack mutation surface/,
    );
  });

  it('rejects assignment from a module-scoped Express application', () => {
    const readFixture = withAdapterSource((source) =>
      source
        .replace(
          'export class ExpressHttpApplicationAdapter',
          'const sharedExpressApplication = express();\n\nexport class ExpressHttpApplicationAdapter',
        )
        .replace('    this.app = express();', '    this.app = sharedExpressApplication; // this.app = express();'),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /construct its own Express application/,
    );
  });

  it('rejects marker comments that hide missing mounts', () => {
    const readFixture = withAdapterSource((source) =>
      source.replace(
        '    for (const middleware of nativeMiddleware) {\n      this.app.use(middleware);\n    }',
        '    // for (const middleware of nativeMiddleware)\n    // this.app.use(middleware);',
      ).replace('    this.app.use(this.router);', '    // this.app.use(this.router);'),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /mount nativeMiddleware before its router/,
    );
  });

  it('rejects native middleware mounted after router setup', () => {
    const readFixture = withAdapterSource((source) =>
      source.replace(
        '    for (const middleware of nativeMiddleware) {\n      this.app.use(middleware);\n    }',
        '    // for (const middleware of nativeMiddleware)\n    // this.app.use(middleware);\n    // this.app.use(this.router);\n    this.app[\'use\'](this.router);\n    for (const middleware of nativeMiddleware) {\n      this.app[\'use\'](middleware);\n    }',
      ).replace('    this.app.use(this.router);', ''),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).toThrow(
      /mount nativeMiddleware before its router/,
    );
  });

  it('accepts constructor-local extraction of the owned application', () => {
    const readFixture = withAdapterSource((source) =>
      source.replace(
        '    this.app = express();',
        '    const ownedApplication = express();\n    this.app = ownedApplication; // this.app = express();',
      ),
    );

    expect(() => enforceExpressApplicationOwnershipDocs(readFixture)).not.toThrow();
  });
});
