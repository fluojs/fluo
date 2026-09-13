import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const contractFields = [
  'application-owned-connection',
  'ambient-session-merge',
  'preserves-operation-options',
  'strict-fail-open',
  'explicit-target',
];
const contractMarkerPatterns = [
  /^<!-- fluo-mongoose-contract: ([a-z-]+(?:, [a-z-]+)*) -->$/gmu,
  /^\{\/\* fluo-mongoose-contract: ([a-z-]+(?:, [a-z-]+)*) \*\/\}$/gmu,
];
const documentationRequirements = [
  {
    heading: '## Mongoose Root and Feature Migration',
    path: 'docs/getting-started/migrate-from-nestjs.md',
    requiresExplicitDiExample: true,
  },
  {
    heading: '## Mongoose 루트와 feature 마이그레이션',
    path: 'docs/getting-started/migrate-from-nestjs.ko.md',
    requiresExplicitDiExample: true,
  },
  {
    heading: '## Context Resolution Rules',
    path: 'docs/architecture/transactions.md',
  },
  {
    heading: '## 문맥 해석 규칙',
    path: 'docs/architecture/transactions.ko.md',
  },
  {
    heading: '## Migration Reference',
    path: 'docs/CONTEXT.md',
  },
  {
    heading: '## Migration Reference',
    path: 'docs/CONTEXT.ko.md',
  },
  {
    heading: '# @fluojs/mongoose',
    path: 'packages/mongoose/README.md',
    requiresExplicitDiExample: true,
  },
  {
    heading: '# @fluojs/mongoose',
    path: 'packages/mongoose/README.ko.md',
    requiresExplicitDiExample: true,
  },
  {
    heading: '## Mongoose',
    path: 'apps/docs/content/docs/guides/persistence.mdx',
  },
  {
    heading: '## Mongoose',
    path: 'apps/docs/content/docs/guides/persistence.ko.mdx',
  },
  {
    heading: '# Chapter 19. MongoDB and Mongoose',
    path: 'book/intermediate/ch19-mongoose.md',
  },
  {
    heading: '# Chapter 19. MongoDB and Mongoose',
    path: 'book/intermediate/ch19-mongoose.ko.md',
  },
];
const saveDocumentContractMarker =
  '<!-- fluo-mongoose-save-document-contract: opt-in, active-session, save-compatible-document -->';
const saveDocumentRequirements = [
  {
    path: 'packages/mongoose/README.md',
    typeConstraint: '  save(options?: UserDocumentSaveOptions): Promise<UserDocument>;',
  },
  {
    path: 'packages/mongoose/README.ko.md',
    typeConstraint: '  save(options?: UserDocumentSaveOptions): Promise<UserDocument>;',
  },
];
const saveDocumentMigrationRequirements = [
  { path: 'docs/getting-started/migrate-from-nestjs.md' },
  { path: 'docs/getting-started/migrate-from-nestjs.ko.md' },
];
const mongooseRemovalFields = new Map([
  ['registration', 'for-root-or-for-root-async'],
  ['providers', 'removed'],
  ['request-transaction-interceptor', 'removed'],
]);
const mongooseRemovalRequirements = [
  { heading: '# @fluojs/mongoose', path: 'packages/mongoose/README.md' },
  { heading: '# @fluojs/mongoose', path: 'packages/mongoose/README.ko.md' },
  { heading: '## Mongoose', path: 'apps/docs/content/docs/guides/persistence.mdx' },
  { heading: '## Mongoose', path: 'apps/docs/content/docs/guides/persistence.ko.mdx' },
];
const mongooseFacadeExamplePaths = [
  'apps/docs/content/docs/guides/persistence.mdx',
  'apps/docs/content/docs/guides/persistence.ko.mdx',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Platform consistency governance check failed: ${message}`);
  }
}

function enforceUniqueLine(content, line, relativePath) {
  const matches = content.split('\n').filter((candidate) => candidate === line);
  assert(
    matches.length === 1,
    `${relativePath} must include exactly one ${line}; found ${matches.length}.`,
  );
}

function enforceMongooseContractMarker(content, relativePath) {
  const markers = contractMarkerPatterns.flatMap((pattern) => [...content.matchAll(pattern)]);
  assert(
    markers.length === 1,
    `${relativePath} must include exactly one fluo-mongoose-contract marker; found ${markers.length}.`,
  );

  const fields = markers[0][1].split(', ');
  assert(
    fields.length === contractFields.length &&
      new Set(fields).size === contractFields.length &&
      contractFields.every((field) => fields.includes(field)),
    `${relativePath} must declare each machine-consumed Mongoose contract field exactly once.`,
  );
}

function enforceExplicitDiExample(content, relativePath) {
  const examples = [...content.matchAll(/```(?:ts|typescript)\s*\n([\s\S]*?)```/gu)]
    .map((match) => match[1] ?? '')
    .filter((example) => example.includes('class UserRepository') && example.includes('class UserService'));
  assert(
    examples.length === 1,
    `${relativePath} must include exactly one fenced UserRepository/UserService migration example.`,
  );

  const example = examples[0];
  const repositoryMatches = [
    ...example.matchAll(/@Inject\(MongooseConnection\)\s*\n(?:export\s+)?class UserRepository\b/gu),
  ];
  const serviceMatches = [
    ...example.matchAll(/@Inject\(UserRepository\)\s*\n(?:export\s+)?class UserService\b/gu),
  ];
  assert(
    repositoryMatches.length === 1 && serviceMatches.length === 1,
    `${relativePath} must declare explicit MongooseConnection and UserRepository constructor tokens.`,
  );
  assert(
    (repositoryMatches[0].index ?? 0) < (serviceMatches[0].index ?? 0),
    `${relativePath} must declare UserRepository before UserService references its token.`,
  );
}

function enforceSaveDocumentContract(content, requirement) {
  enforceUniqueLine(content, saveDocumentContractMarker, requirement.path);
  const typeConstraints = content
    .split('\n')
    .filter((candidate) => candidate === requirement.typeConstraint);
  assert(
    typeConstraints.length === 1,
    `${requirement.path} must include exactly one save-compatible document type constraint; found ${typeConstraints.length}.`,
  );
}

function enforceSaveDocumentMigrationExample(content, requirement) {
  const examples = [...content.matchAll(/```(?:ts|typescript)\s*\n([\s\S]*?)```/gu)]
    .map((match) => match[1] ?? '')
    .filter((example) => example.includes('class ProfileService') && example.includes('saveDocument'));
  assert(
    examples.length === 1,
    `${requirement.path} must include exactly one fenced ProfileService saveDocument migration example.`,
  );

  const injectionMatches = [
    ...examples[0].matchAll(/@Inject\(MongooseConnection\)\s*\n(?:export\s+)?class ProfileService\b/gu),
  ];
  assert(
    injectionMatches.length === 1,
    `${requirement.path} must declare MongooseConnection explicitly for ProfileService.`,
  );
}

function enforceMongooseRemovalClaim(content, requirement) {
  const markerPattern = requirement.path.endsWith('.mdx')
    ? /^\{\/\* fluo-mongoose-removal: ([a-z-]+=[a-z-]+(?:; [a-z-]+=[a-z-]+)*) \*\/\}$/gmu
    : /^<!-- fluo-mongoose-removal: ([a-z-]+=[a-z-]+(?:; [a-z-]+=[a-z-]+)*) -->$/gmu;
  const markers = [...content.matchAll(markerPattern)];

  assert(
    markers.length === 1,
    `${requirement.path} must include exactly one fluo-mongoose-removal marker; found ${markers.length}.`,
  );

  const entries = markers[0][1].split('; ').map((field) => field.split('='));
  const fieldKeys = entries.map(([field]) => field);
  const duplicateFieldKeys = [
    ...new Set(fieldKeys.filter((field, index) => fieldKeys.indexOf(field) !== index)),
  ];
  assert(
    duplicateFieldKeys.length === 0,
    `${requirement.path} fluo-mongoose-removal marker must not declare duplicate field keys: ${duplicateFieldKeys.join(', ')}.`,
  );

  const fields = new Map(entries);
  assert(
    entries.length === mongooseRemovalFields.size &&
      fields.size === mongooseRemovalFields.size &&
      [...mongooseRemovalFields].every(([field, value]) => fields.get(field) === value) &&
      [...fields.keys()].every((field) => mongooseRemovalFields.has(field)),
    `${requirement.path} fluo-mongoose-removal marker must declare each machine-consumed Mongoose removal field exactly once.`,
  );

  const governedRegion = `${requirement.heading}\n\n${markers[0][0]}`;
  assert(
    content.split(governedRegion).length === 2,
    `${requirement.path} fluo-mongoose-removal marker must anchor its Mongoose removal claim directly below ${requirement.heading}.`,
  );
}

function enforceMongooseModuleRemovalSourceStructure(readText) {
  const moduleSource = readText('packages/mongoose/src/module.ts');
  const barrelSource = readText('packages/mongoose/src/index.ts');

  assert(
    /^export class MongooseModule \{$/mu.test(moduleSource) &&
      /^ {2}static forRoot</mu.test(moduleSource) &&
      /^ {2}static forRootAsync</mu.test(moduleSource),
    'packages/mongoose/src/module.ts must expose MongooseModule.forRoot() and MongooseModule.forRootAsync().',
  );
  assert(
    /^export \* from '\.\/module\.js';$/mu.test(barrelSource),
    'packages/mongoose/src/index.ts must retain the MongooseModule barrel export.',
  );

  for (const removedExport of ['createMongooseProviders', 'MongooseTransactionInterceptor']) {
    assert(
      !new RegExp(
        `^export\\s+(?:class|const|function)\\s+${removedExport}\\b|^export\\s*\\{[^\\n]*\\b${removedExport}\\b[^\\n]*\\}`,
        'mu',
      ).test(moduleSource),
      `packages/mongoose/src/module.ts must not export ${removedExport}.`,
    );
    assert(
      !new RegExp(
        `^export\\s+(?:class|const|function)\\s+${removedExport}\\b|^export\\s*\\{[^\\n]*\\b${removedExport}\\b[^\\n]*\\}`,
        'mu',
      ).test(barrelSource),
      `packages/mongoose/src/index.ts must not export ${removedExport}.`,
    );
  }
}

function enforceMongooseFacadeExample(content, relativePath) {
  const examples = [...content.matchAll(/```(?:ts|typescript)\s*\n([\s\S]*?)```/gu)]
    .map((match) => match[1] ?? '')
    .filter(
      (example) =>
        example.includes('MongooseConnection') &&
        example.includes('class UserRepository') &&
        example.includes('findById'),
    );

  assert(
    examples.length === 1,
    `${relativePath} must include exactly one Mongoose UserRepository facade example.`,
  );

  const example = examples[0];
  assert(
    example.includes("type UserModel = MongooseModelFacade<unknown, unknown, Promise<User | null>>;") &&
      example.includes("this.conn.model<UserModel>('User')") &&
      example.includes('User.findOne({ _id: id })') &&
      !example.includes('User.findById('),
    `${relativePath} must use a typed MongooseModelFacade.findOne({ _id: id }) example.`,
  );
}

export function enforceMongooseNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const requirement of documentationRequirements) {
    const content = readText(requirement.path);
    enforceMongooseContractMarker(content, requirement.path);
    enforceUniqueLine(content, requirement.heading, requirement.path);

    if (requirement.requiresExplicitDiExample) {
      enforceExplicitDiExample(content, requirement.path);
    }
  }

  for (const requirement of saveDocumentRequirements) {
    enforceSaveDocumentContract(readText(requirement.path), requirement);
  }

  for (const requirement of saveDocumentMigrationRequirements) {
    enforceSaveDocumentMigrationExample(readText(requirement.path), requirement);
  }

  for (const requirement of mongooseRemovalRequirements) {
    enforceMongooseRemovalClaim(readText(requirement.path), requirement);
  }

  for (const relativePath of mongooseFacadeExamplePaths) {
    enforceMongooseFacadeExample(readText(relativePath), relativePath);
  }

  enforceMongooseModuleRemovalSourceStructure(readText);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  enforceMongooseNestjsMigrationDocs();
}
