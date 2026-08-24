import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const domainPath = resolve(import.meta.dirname, '../references/domain.json');
const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readRecord = (value, name) => {
  if (!isRecord(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
  return value;
};

const readStrings = (value, name) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${name} must be an array of strings.`);
  }
  return value;
};

class IntakeError extends TypeError {
  constructor(error, token, suggestions = []) {
    super(error);
    this.error = error;
    this.token = token;
    this.suggestions = suggestions;
  }
}

const domain = readRecord(JSON.parse(readFileSync(domainPath, 'utf8')), 'domain');
const intake = readRecord(domain.intake, 'domain.intake');
const groups = readRecord(domain.groups, 'domain.groups');
const purposes = readRecord(domain.purposes, 'domain.purposes');
const groupLabels = readRecord(intake.group_labels, 'domain.intake.group_labels');
const groupDescriptions = readRecord(
  intake.group_descriptions,
  'domain.intake.group_descriptions',
);
const purposeLabels = readRecord(
  intake.purpose_labels,
  'domain.intake.purpose_labels',
);
const purposeDescriptions = readRecord(
  intake.purpose_descriptions,
  'domain.intake.purpose_descriptions',
);
const packages = readStrings(domain.packages, 'domain.packages');

const targetModes = (() => {
  if (!Array.isArray(intake.target_modes)) {
    throw new TypeError('domain.intake.target_modes must be an array.');
  }
  return intake.target_modes.map((value) => {
    const mode = readRecord(value, 'target mode');
    if (
      typeof mode.id !== 'string' ||
      typeof mode.label !== 'string' ||
      typeof mode.description !== 'string'
    ) {
      throw new TypeError('Every target mode needs id, label, and description.');
    }
    return { id: mode.id, label: mode.label, description: mode.description };
  });
})();

const unique = (values) => [...new Set(values)];
const publicName = (packageName) => `@fluojs/${packageName}`;
const entriesFor = (slugs, labels, prefix = '') =>
  slugs.map((slug, index) => ({
    slug,
    number: String(index + 1),
    label: typeof labels[slug] === 'string' ? labels[slug] : `${prefix}${slug}`,
  }));

const editDistance = (left, right) => {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (const [leftIndex, leftCharacter] of [...left].entries()) {
    let diagonal = row[0];
    row[0] = leftIndex + 1;
    for (const [rightIndex, rightCharacter] of [...right].entries()) {
      const above = row[rightIndex + 1];
      row[rightIndex + 1] = Math.min(
        above + 1,
        row[rightIndex] + 1,
        diagonal + (leftCharacter === rightCharacter ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return row[right.length];
};

const suggestionsFor = (token, entries) => {
  const ranked = entries
    .map((entry) => ({ slug: entry.slug, distance: editDistance(token, entry.slug) }))
    .sort((left, right) => left.distance - right.distance || left.slug.localeCompare(right.slug));
  const closest = ranked[0]?.distance;
  return closest !== undefined && closest <= 3
    ? ranked.filter((entry) => entry.distance === closest).map((entry) => entry.slug)
    : entries.slice(0, 3).map((entry) => entry.slug);
};

const resolveTokens = (kind, selections, entries) => {
  if (selections.length === 0) {
    throw new IntakeError(`missing_${kind}`, '', entries.slice(0, 3).map(({ slug }) => slug));
  }
  return unique(
    selections.map((token) => {
      const normalized = token.startsWith('@fluojs/') ? token.slice(8) : token;
      const matches = entries.filter(
        ({ slug, number, label }) => normalized === slug || token === number || token === label,
      );
      if (matches.length === 0) {
        throw new IntakeError(`unknown_${kind}`, token, suggestionsFor(normalized, entries));
      }
      return matches[0].slug;
    }),
  );
};

const groupEntries = entriesFor(Object.keys(groups), groupLabels);
const packageEntries = entriesFor(packages, {}, '@fluojs/');
const purposeEntries = entriesFor(Object.keys(purposes), purposeLabels);

const resolveScope = (mode, selections) => {
  switch (mode) {
    case 'all':
      return { mode, packages };
    case 'group': {
      const selectedGroups = resolveTokens('group', selections, groupEntries);
      return {
        mode,
        groups: selectedGroups,
        packages: unique(
          selectedGroups.flatMap((group) => readStrings(groups[group], `group ${group}`)),
        ),
      };
    }
    case 'package':
      return { mode, packages: resolveTokens('package', selections, packageEntries) };
    default:
      throw new IntakeError('unknown_target_mode', mode, targetModes.map(({ id }) => id));
  }
};

const resolveBareScope = (selections) => {
  if (selections.length === 0) {
    throw new IntakeError('missing_scope', '', ['전체 패키지', '패키지군', '패키지']);
  }
  const groupMatches = selections.every((token) =>
    groupEntries.some(({ slug, number, label }) => [slug, number, label].includes(token)),
  );
  const packageMatches = selections.every((token) =>
    packageEntries.some(({ slug, number, label }) =>
      [slug, number, label, publicName(slug)].includes(token),
    ),
  );
  if (groupMatches && packageMatches) {
    throw new IntakeError('ambiguous_selection', selections[0], [
      `패키지군 ${selections[0]}`,
      `패키지 ${selections[0]}`,
    ]);
  }
  if (groupMatches) return resolveScope('group', selections);
  if (packageMatches) return resolveScope('package', selections);
  throw new IntakeError('unknown_scope', selections[0], [
    ...suggestionsFor(selections[0], groupEntries),
    ...suggestionsFor(selections[0], packageEntries),
  ]);
};

const renderPackageCatalog = () => {
  const packageNumbers = new Map(packageEntries.map(({ slug, number }) => [slug, number]));
  const rows = groupEntries.map(({ slug, number, label }) => {
    const description = groupDescriptions[slug];
    if (typeof description !== 'string') {
      throw new TypeError(`Missing description for group ${slug}.`);
    }
    const members = readStrings(groups[slug], `group ${slug}`)
      .map((name) => `${packageNumbers.get(name)}. ${publicName(name)} (${name})`)
      .join(', ');
    return `| ${slug} | ${number}. ${label} | ${description}; ${members} |`;
  });
  return ['| 패키지군 | 설명 | 포함 패키지 |', '| --- | --- | --- |', ...rows].join('\n');
};

const renderPurposeCatalog = () => {
  const rows = purposeEntries.map(({ slug, number, label }) => {
    const description = purposeDescriptions[slug];
    if (typeof description !== 'string') {
      throw new TypeError(`Missing description for purpose ${slug}.`);
    }
    return `| ${slug} | ${number}. ${label} — ${description} | ${readStrings(purposes[slug], `purpose ${slug}`).join(', ')} |`;
  });
  return ['| 감사 목적 | 살펴보는 내용 | 실행 reviewer |', '| --- | --- | --- |', ...rows].join('\n');
};

const verifyWorkspace = (root) => {
  const packageRoot = resolve(root, 'packages');
  const workspacePackages = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(packageRoot, entry.name, 'package.json')))
    .map(({ name }) => name)
    .sort();
  const expected = [...packages].sort();
  const missing = expected.filter((name) => !workspacePackages.includes(name));
  const extra = workspacePackages.filter((name) => !expected.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    const error = new IntakeError('workspace_catalog_drift', root);
    error.missing = missing;
    error.extra = extra;
    throw error;
  }
  return { packages: expected };
};

const [command, ...arguments_] = process.argv.slice(2);
try {
  let output;
  switch (command) {
    case 'modes': output = targetModes; break;
    case 'packages': output = renderPackageCatalog(); break;
    case 'purposes': output = renderPurposeCatalog(); break;
    case 'resolve': {
      const [mode, ...selections] = arguments_;
      output = resolveScope(mode, selections);
      break;
    }
    case 'resolve-scope': output = resolveBareScope(arguments_); break;
    case 'resolve-purposes':
      output = { purposes: resolveTokens('purpose', arguments_, purposeEntries) };
      break;
    case 'verify-workspace': output = verifyWorkspace(arguments_[0] ?? process.cwd()); break;
    default: throw new IntakeError('unknown_command', command ?? '', ['modes', 'packages', 'purposes', 'resolve', 'resolve-scope', 'resolve-purposes', 'verify-workspace']);
  }
  console.log(typeof output === 'string' ? output : JSON.stringify(output, null, 2));
} catch (error) {
  if (error instanceof IntakeError) {
    const structured = { error: error.error, token: error.token, suggestions: error.suggestions };
    if ('missing' in error) structured.missing = error.missing;
    if ('extra' in error) structured.extra = error.extra;
    process.stderr.write(`${JSON.stringify(structured)}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
