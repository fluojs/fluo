import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  enforceNoRootMappedTypeImports,
  enforceValidationMappedTypesImportBoundary,
} from './validation-mapped-types-import-boundary.mjs';

function readSource(sourcePath: string) {
  return readFileSync(join(import.meta.dirname, '../..', sourcePath), 'utf8');
}

function fixtureReader(sourcePath: string, mutate: (source: string) => string) {
  return (relativePath: string) => {
    const source = readSource(relativePath);
    return relativePath === sourcePath ? mutate(source) : source;
  };
}

function mutateSection(source: string, heading: string, mutate: (section: string) => string) {
  const start = source.indexOf(`${heading}\n`) + heading.length + 1;
  const remainder = source.slice(start);
  const level = heading.match(/^#+/u)?.[0].length;
  const next = remainder.search(new RegExp(`^#{1,${level}} `, 'mu'));
  const end = next === -1 ? source.length : start + next;
  return source.slice(0, start) + mutate(source.slice(start, end)) + source.slice(end);
}

describe('validation mapped-type import boundary governance', () => {
  it('keeps governed source and documentation examples on the canonical subpath', () => {
    expect(() => enforceValidationMappedTypesImportBoundary()).not.toThrow();
  });

  it('rejects mapped helper imports from the validation package root in source', () => {
    expect(() => enforceNoRootMappedTypeImports(
      "import { PickType } from '@fluojs/validation';",
      'packages/http/src/users.ts',
    )).toThrow(/packages\/http\/src\/users\.ts.*@fluojs\/validation\/mapped-types/u);
  });

  it('rejects mapped helper imports from the validation package root in code fences', () => {
    expect(() => enforceNoRootMappedTypeImports(
      "```ts\nimport { OmitType as PublicUser } from '@fluojs/validation';\n```",
      'docs/getting-started/migrate-from-nestjs.md',
    )).toThrow(/docs\/getting-started\/migrate-from-nestjs\.md.*OmitType/u);
  });

  for (const sourcePath of [
    'packages/validation/README.md',
    'packages/validation/README.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
  ]) {
    const korean = sourcePath.endsWith('.ko.md');
    const readme = sourcePath.startsWith('packages/');
    const headings = [
      readme
        ? korean ? '## 빠른 시작' : '## Quick Start'
        : korean ? '## Decorator metadata 사전 로드 순서' : '## Decorator metadata preload ordering',
      readme
        ? korean ? '### Mapped DTO 헬퍼' : '### Mapped DTO helpers'
        : '### Nested DTO and Mapped Type Rewrites',
    ];

    for (const [index, heading] of headings.entries()) {
      const sentinel = `<!-- fluo-contract: validation.${index === 0 ? 'metadata-preload' : 'mapped-defaults'} -->`;
      const diagnostic = index === 0 ? 'metadata preload' : 'mapped DTO constructor/default boundaries';
      const reader = (mutate: (section: string) => string) => fixtureReader(
        sourcePath,
        (source) => mutateSection(source, heading, mutate),
      );

      it.each(['reworded', 'wrapped', 'added-explanation'])(
        `accepts %s prose with preserved structure for ${heading} in ${sourcePath}`,
        (mutation) => {
          const readText = reader((section) => section.split(/(```[\s\S]*?```|<!--[\s\S]*?-->)/u)
            .map((part, partIndex) => {
              if (partIndex % 2 === 1 || !part.trim()) {
                return part;
              }
              if (mutation === 'wrapped') {
                return part.replace(/\s+/gu, ' ').replace(/ /gu, '\n');
              }
              const explanation = korean ? '예제의 실행 구조를 유지합니다.' : 'The example retains its execution structure.';
              return mutation === 'reworded' ? `\n\n${explanation}\n\n` : `${part}\n${explanation}\n`;
            }).join(''));

          expect(() => enforceValidationMappedTypesImportBoundary(readText)).not.toThrow();
        },
      );

      it.each(['missing', 'duplicated', 'outside-section'])(
        `rejects %s sentinel for ${heading} in ${sourcePath}`,
        (mutation) => {
          expect(readSource(sourcePath)).toContain(sentinel);
          const readText = fixtureReader(sourcePath, (source) => {
            const modified = mutateSection(source, heading, (section) => section.replace(
              sentinel,
              mutation === 'duplicated' ? `${sentinel}\n${sentinel}` : '',
            ));
            return mutation === 'outside-section' ? `${modified}\n${sentinel}\n` : modified;
          });

          expect(() => enforceValidationMappedTypesImportBoundary(readText))
            .toThrow(`${sourcePath} must document validation ${diagnostic}`);
        },
      );

      it.each([
        ['missing', ''],
        ['level-changed', `#${heading}`],
        ['inline', `See ${heading}`],
        ['suffixed', `${heading} extra`],
        ['duplicated', heading],
      ])(`rejects %s heading ${heading} in ${sourcePath}`, (mutation, replacement) => {
        const readText = fixtureReader(sourcePath, (source) => mutation === 'duplicated'
          ? `${source}\n\n${heading}\n`
          : source.replace(heading, replacement));

        expect(() => enforceValidationMappedTypesImportBoundary(readText))
          .toThrow(`${sourcePath} must contain exactly one line-exact heading: ${heading}`);
      });
    }

    const preloadHeading = headings[0];
    const preloadReader = (mutate: (section: string) => string) => fixtureReader(
      sourcePath,
      (source) => mutateSection(source, preloadHeading, mutate),
    );
    const preloadDiagnostic = `${sourcePath} must document validation metadata preload`;

    // Mutate each README example separately so a second valid fence cannot mask it.
    for (const blockIndex of readme ? [0, 1] : [0]) {
      it.each([
        'missing-call', 'line-comment', 'block-comment', 'late-call', 'missing-import',
        'wrong-import', 'type-import', 'string-call', 'uninvoked-function', 'static-graph-import',
        'commented-fence', 'missing-fence',
      ])(`rejects %s preload in block ${blockIndex} of ${sourcePath}`, (mutation) => {
        const readText = preloadReader((section) => {
          let index = 0;
          return section.replace(/```(?:ts|typescript)\n([\s\S]*?)```/gu, (fence: string, code: string) => {
            if (index++ !== blockIndex) {
              return fence;
            }
            if (mutation === 'commented-fence') {
              return `<!--\n${fence}\n-->`;
            }
            if (mutation === 'missing-fence') {
              return '';
            }
            let modified = code;
            switch (mutation) {
              case 'missing-call': modified = code.replace('ensureMetadataSymbol();', ''); break;
              case 'line-comment': modified = code.replace('ensureMetadataSymbol();', '// ensureMetadataSymbol();'); break;
              case 'block-comment': modified = code.replace('ensureMetadataSymbol();', '/* ensureMetadataSymbol(); */'); break;
              case 'late-call': modified = `${code.replace('ensureMetadataSymbol();', '')}\nensureMetadataSymbol();\n`; break;
              case 'missing-import': modified = code.replace("import { ensureMetadataSymbol } from '@fluojs/core';", ''); break;
              case 'wrong-import': modified = code.replace("'@fluojs/core'", "'@fluojs/validation'"); break;
              case 'type-import': modified = code.replace('import { ensureMetadataSymbol }', 'import type { ensureMetadataSymbol }'); break;
              case 'string-call': modified = code.replace('ensureMetadataSymbol();', "'ensureMetadataSymbol();';"); break;
              case 'uninvoked-function': modified = code.replace('ensureMetadataSymbol();', 'function unused() { ensureMetadataSymbol(); }'); break;
              case 'static-graph-import': modified = `${code}\nimport './bootstrap.js';\n`; break;
            }
            return fence.replace(code, modified);
          });
        });

        expect(() => enforceValidationMappedTypesImportBoundary(readText)).toThrow(preloadDiagnostic);
      });
    }

    it(`accepts active aliased and line-wrapped preload code in ${sourcePath}`, () => {
      const readText = preloadReader((section) => section
        .replaceAll('import { ensureMetadataSymbol }', 'import {\n ensureMetadataSymbol as prepareMetadata,\n}')
        .replaceAll('ensureMetadataSymbol();', 'prepareMetadata(\n);'));

      expect(() => enforceValidationMappedTypesImportBoundary(readText)).not.toThrow();
    });

    const mappedHeading = headings[1];
    const defaultLine = readme ? "  email = 'hello@example.com';" : '  address = new AddressDto();';
    const mappedReader = (mutate: (section: string) => string) => fixtureReader(
      sourcePath,
      (source) => mutateSection(source, mappedHeading, mutate),
    );

    it.each(['deleted', 'commented', 'no-initializer', 'undefined', 'unrelated-field', 'wrong-helper'])(
      `rejects %s mapped subclass default in ${sourcePath}`,
      (mutation) => {
        const readText = mappedReader((section) => {
          // The migration has the same initializer in both source and subclass.
          const start = section.indexOf(readme ? 'class EmailOnlyDto' : 'class AddressOnlyDto');
          const prefix = section.slice(0, start);
          const subclass = section.slice(start);
          const field = readme ? 'email' : 'address';
          const replacement = mutation === 'deleted' ? ''
            : mutation === 'commented' ? `// ${defaultLine}`
              : mutation === 'no-initializer' ? `  ${field}: unknown;`
                : mutation === 'undefined' ? `  ${field} = undefined;`
                  : defaultLine.replace(field, 'unrelated');
          return prefix + (mutation === 'wrong-helper'
            ? subclass.replace('extends PickType', 'extends PartialType')
            : subclass.replace(defaultLine, replacement));
        });

        expect(() => enforceValidationMappedTypesImportBoundary(readText))
          .toThrow(`${sourcePath} must document validation mapped DTO constructor/default boundaries`);
      },
    );

    it.each(['PickType', 'OmitType', 'IntersectionType'])(
      `accepts %s subclass with a re-declared default in ${sourcePath}`,
      (helper) => {
        const readText = mappedReader((section) => section.replace(
          /class (EmailOnlyDto|AddressOnlyDto) extends PickType\([^\n]+\)/u,
          `class $1 extends ${helper}(SourceDto)`,
        ).replace(
          /import \{[^}]*\} from '@fluojs\/validation\/mapped-types';/u,
          `import { ${helper}, PartialType } from '@fluojs/validation/mapped-types';`,
        ));

        expect(() => enforceValidationMappedTypesImportBoundary(readText)).not.toThrow();
      },
    );
  }
});
