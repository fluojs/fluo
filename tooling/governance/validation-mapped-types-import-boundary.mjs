import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const validationRootSpecifier = '@fluojs/validation';
const validationMappedTypesSpecifier = '@fluojs/validation/mapped-types';
const mappedTypeHelpers = new Set(['IntersectionType', 'OmitType', 'PartialType', 'PickType']);

const governedPaths = [
  'packages/http/src/decorators.test.ts',
  'packages/http/src/dispatch/dispatcher.test.ts',
  'packages/openapi/src/openapi-module.test.ts',
  'packages/validation/README.md',
  'packages/validation/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/contracts/nestjs-parity-gaps.md',
  'docs/contracts/nestjs-parity-gaps.ko.md',
  'apps/docs/content/docs/guides/validation-serialization.mdx',
  'book/beginner/ch06-validation.md',
  'book/beginner/ch06-validation.ko.md',
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
];

// Pin the approved sections as well as each claim line: otherwise an additional
// contradictory sentence can coexist with a valid canonical statement. Update the
// section digest only alongside an intentional EN/KO guidance change.
const canonicalGuidance = [
  {
    "sourcePath": "packages/validation/README.md",
    "heading": "## Quick Start",
    "diagnostic": "metadata preload before decorated DTO modules evaluate.",
    "statement": [
      "`Symbol.metadata` must exist before any DTO module using validation field",
      "decorators or `@ValidateClass(...)` evaluates. Importing `@fluojs/validation`",
      "does not install it. Call `ensureMetadataSymbol()` before decorated class",
      "declarations in the same module, as below."
    ],
    "sectionSha256": "c7448e751bfa6cf1ad64760b8a5de468627abcf1c62abdf9eb31778065252761"
  },
  {
    "sourcePath": "packages/validation/README.md",
    "heading": "### Mapped DTO helpers",
    "diagnostic": "mapped DTO constructor/default boundaries.",
    "statement": [
      "`PickType`, `OmitType`, and `IntersectionType` do not run source DTO constructors",
      "or copy field initializer/default values. The derived class initializes retained",
      "fields discovered through validation or binding metadata to `undefined`.",
      "Redeclare a field in the subclass when its default is needed, as shown by",
      "`EmailOnlyDto.email` above. `PartialType` also avoids source constructors and",
      "defaults; it deliberately preserves `undefined` for missing patch fields rather",
      "than restoring create defaults. Do not redeclare create defaults on",
      "`UpdateUserDto`."
    ],
    "sectionSha256": "e2fa8ee125a2da257066c47a6b0564ce6795e280e8b0aadb99eb3f6e26f031e3"
  },
  {
    "sourcePath": "packages/validation/README.ko.md",
    "heading": "## 빠른 시작",
    "diagnostic": "metadata preload before decorated DTO modules evaluate.",
    "statement": [
      "Validation field decorator와 `@ValidateClass(...)`를 사용하는 DTO module이",
      "평가되기 전에 `Symbol.metadata`가 있어야 합니다. `@fluojs/validation` import는",
      "이를 설치하지 않습니다. 아래처럼 같은 module의 decorated class 선언 전에",
      "`ensureMetadataSymbol()`을 호출하세요."
    ],
    "sectionSha256": "c059ad3dcc8c6c60f4a4171a5c234e183e0431699d3e3c8d97fe4589a41a1846"
  },
  {
    "sourcePath": "packages/validation/README.ko.md",
    "heading": "### Mapped DTO 헬퍼",
    "diagnostic": "mapped DTO constructor/default boundaries.",
    "statement": [
      "`PickType`, `OmitType`, `IntersectionType`은 source DTO 생성자를 실행하거나",
      "field initializer/default 값을 복사하지 않습니다. Derived class는 validation",
      "또는 binding metadata에서 발견한 retained field를 `undefined`로 초기화합니다.",
      "필요한 기본값은 위의 `EmailOnlyDto.email`처럼 subclass에서 field를 다시",
      "선언하세요. `PartialType`도 source 생성자와 기본값을 사용하지 않으며,",
      "create 기본값을 복원하는 대신 누락된 patch field를 `undefined`로 유지하도록",
      "의도되었습니다. `UpdateUserDto`에는 create 기본값을 다시 선언하지 않습니다."
    ],
    "sectionSha256": "b7d6048cd28967699598cc55f11583dfd7d01b19892399e32d000cb5b6489b13"
  },
  {
    "sourcePath": "docs/getting-started/migrate-from-nestjs.md",
    "heading": "## Decorator metadata preload ordering",
    "diagnostic": "metadata preload before decorated DTO modules evaluate.",
    "statement": [
      "Importing fluo packages does not install `Symbol.metadata`. Field decorators and `@ValidateClass(...)` from `@fluojs/validation`, `@fluojs/serialization` decorators, and migrated custom standard decorators that read `context.metadata` need `Symbol.metadata` before their decorated class modules evaluate. This is TC39 decorator metadata, not an instruction to enable unsupported `reflect-metadata` or `emitDecoratorMetadata`."
    ],
    "sectionSha256": "6ad7917f0d6919b9ec13723f06c7fb3263e8d5f1d37f493baa10bccf8852e752"
  },
  {
    "sourcePath": "docs/getting-started/migrate-from-nestjs.md",
    "heading": "### Nested DTO and Mapped Type Rewrites",
    "diagnostic": "mapped DTO constructor/default boundaries.",
    "statement": [
      "`PickType`, `OmitType`, and `IntersectionType` do not run source DTO constructors",
      "or copy field initializer/default values. The derived class initializes retained",
      "fields discovered through validation or binding metadata to `undefined`.",
      "Consequently, `CreateUserDto.address = new AddressDto()` does not carry over",
      "automatically. Redeclare `address` in the subclass when a nested object default",
      "is needed, as shown in `AddressOnlyDto` above. `PartialType` also avoids source",
      "constructors and defaults; its purpose is to preserve `undefined` for missing",
      "patch fields. Do not restore create defaults on `UpdateUserDto`, because that",
      "would erase the patch distinction between omission and an explicit update."
    ],
    "sectionSha256": "cccdf971fafc6547107cedd874226aaa56a87323d498c5e7fa9f7411e62da2d5"
  },
  {
    "sourcePath": "docs/getting-started/migrate-from-nestjs.ko.md",
    "heading": "## Decorator metadata 사전 로드 순서",
    "diagnostic": "metadata preload before decorated DTO modules evaluate.",
    "statement": [
      "fluo package import는 `Symbol.metadata`를 설치하지 않습니다. `@fluojs/validation`의 field decorator와 `@ValidateClass(...)`, `@fluojs/serialization` 데코레이터, `context.metadata`를 읽도록 마이그레이션한 사용자 정의 표준 데코레이터는 decorated class module이 평가되기 전에 `Symbol.metadata`가 필요합니다. 이는 TC39 decorator metadata이며, 지원하지 않는 `reflect-metadata`나 `emitDecoratorMetadata`를 활성화하라는 뜻이 아닙니다."
    ],
    "sectionSha256": "710f6150d1dda29f36d305ce3a1af882a20aca8dcb1d2c875d7da55538398314"
  },
  {
    "sourcePath": "docs/getting-started/migrate-from-nestjs.ko.md",
    "heading": "### Nested DTO and Mapped Type Rewrites",
    "diagnostic": "mapped DTO constructor/default boundaries.",
    "statement": [
      "`PickType`, `OmitType`, `IntersectionType`은 source DTO 생성자를 실행하거나",
      "field initializer/default 값을 복사하지 않습니다. Derived class는 validation",
      "또는 binding metadata에서 발견한 retained field를 `undefined`로 초기화합니다.",
      "따라서 `CreateUserDto.address = new AddressDto()`는 자동으로 이어지지 않습니다.",
      "중첩 객체 기본값이 필요하면 위의 `AddressOnlyDto`처럼 subclass에서 `address`를",
      "다시 선언하세요. `PartialType`도 source 생성자와 기본값을 사용하지 않으며,",
      "누락된 patch field를 `undefined`로 유지하는 것이 목적입니다.",
      "`UpdateUserDto`에 create 기본값을 복원하면 누락과 명시적인 업데이트를 구별하려는",
      "patch 의미가 사라지므로 기본값을 다시 선언하지 않습니다."
    ],
    "sectionSha256": "1fe17f2e65c82b8c3bffbf53132c1d2e91b8a8ea6840555c42500d1bb808df26"
  }
];

function defaultReadText(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function collectRootMappedTypeImports(source) {
  const imports = [];
  const pattern = new RegExp(String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]${validationRootSpecifier}['"]`, 'gu');
  let match = pattern.exec(source);

  while (match) {
    const helpers = match[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u)[0].trim())
      .filter((entry) => mappedTypeHelpers.has(entry));

    if (helpers.length > 0) {
      imports.push(...helpers);
    }

    match = pattern.exec(source);
  }

  return imports;
}

function contentAfterUniqueHeading(source, heading, sourcePath) {
  const lines = source.split(/\r?\n/u);
  const matches = lines.flatMap((line, index) => line === heading ? [index] : []);
  if (matches.length !== 1) {
    throw new Error(`${sourcePath} must contain exactly one line-exact heading: ${heading}`);
  }
  const start = matches[0] + 1;
  const level = heading.match(/^#+/u)[0].length;
  const nextHeading = new RegExp(`^#{1,${level}} `, 'u');
  const end = lines.findIndex((line, index) => index >= start && nextHeading.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

/**
 * Reject mapped helper imports from the validation root in TypeScript source
 * and Markdown/MDX code fences.
 *
 * @param source Source text or documentation text to inspect.
 * @param sourcePath Repository-relative path used in diagnostic output.
 */
export function enforceNoRootMappedTypeImports(source, sourcePath) {
  const rootMappedImports = collectRootMappedTypeImports(source);

  if (rootMappedImports.length > 0) {
    throw new Error(
      `${sourcePath} must import ${rootMappedImports.join(', ')} from ${validationMappedTypesSpecifier}, not ${validationRootSpecifier}.`,
    );
  }
}

/**
 * Enforce canonical mapped-type imports and the validation metadata preload
 * and mapped constructor/default guidance in the EN/KO owner documents.
 *
 * @param readText Optional source reader used to inject governance fixtures.
 */
export function enforceValidationMappedTypesImportBoundary(readText = defaultReadText) {
  for (const relativePath of governedPaths) {
    const source = readText(relativePath);
    enforceNoRootMappedTypeImports(source, relativePath);

    for (const guidance of canonicalGuidance.filter((entry) => entry.sourcePath === relativePath)) {
      const section = contentAfterUniqueHeading(source, guidance.heading, relativePath);
      const lines = section.split('\n');
      const diagnostic = `${relativePath} must document validation ${guidance.diagnostic}`;
      for (const expectedLine of guidance.statement) {
        const count = lines.filter((line) => line === expectedLine).length;
        if (count !== 1) {
          throw new Error(
            `${diagnostic} Expected exactly one canonical line in ${guidance.heading}; found ${count}: ${expectedLine}`,
          );
        }
      }
      if (createHash('sha256').update(section).digest('hex') !== guidance.sectionSha256) {
        throw new Error(
          `${diagnostic} Section ${guidance.heading} differs from canonical guidance; additional or rewritten claims are not allowed.`,
        );
      }
    }
  }
}
