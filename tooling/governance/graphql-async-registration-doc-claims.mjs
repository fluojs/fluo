const englishContradictions = [
  /\bsynchronous(?:[\s-]+only|[\s-]+registration[\s-]+only)\b/iu,
  /\bonly\s+(?:supports?|provides?|offers?|uses?)\s+(?:the\s+)?synchronous\b/iu,
  /\bforRootAsync(?:\(\.\.\.\))?\s+(?:is\s+)?(?:unsupported|unavailable|not\s+supported|has\s+no\s+contract)\b/iu,
];
const koreanContradictions = [
  /동기\s*전용/u,
  /동기(?:적(?:인|으로)?)?\s*(?:등록|설정)?\s*만\s*(?:지원|사용|제공|가능)/u,
  /forRootAsync(?:\(\.\.\.\))?[^.!?]{0,24}(?:계약(?:은|이)?\s*없|지원하지\s*않|제공하지\s*않)/iu,
];

export function hasSynchronousOnlyClaim(documentation) {
  const normalized = documentation.replaceAll('`', '').replace(/\s+/gu, ' ');

  return [...englishContradictions, ...koreanContradictions].some((pattern) => pattern.test(normalized));
}

export function readGraphqlMigrationTableRow(documentation, relativePath, assert) {
  const rows = documentation.split('\n').filter((line) => line.includes('| `@nestjs/graphql`'));
  assert(rows.length === 1, relativePath, 'must retain exactly one @nestjs/graphql migration table row');
  return rows[0];
}
