import { readFileSync } from 'node:fs';
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

const domain = readRecord(
  JSON.parse(readFileSync(domainPath, 'utf8')),
  'domain',
);
const intake = readRecord(domain.intake, 'domain.intake');
const groups = readRecord(domain.groups, 'domain.groups');
const purposes = readRecord(domain.purposes, 'domain.purposes');
const groupDescriptions = readRecord(
  intake.group_descriptions,
  'domain.intake.group_descriptions',
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
    return {
      id: mode.id,
      label: mode.label,
      description: mode.description,
    };
  });
})();

const unique = (values) => [...new Set(values)];
const publicName = (packageName) => `@fluojs/${packageName}`;

const requireSelections = (mode, selections) => {
  if (selections.length === 0) {
    throw new TypeError(`${mode} mode requires at least one selection.`);
  }
};

const resolveScope = (mode, selections) => {
  switch (mode) {
    case 'all':
      return { mode, packages };
    case 'group': {
      requireSelections(mode, selections);
      const selectedPackages = selections.flatMap((group) =>
        readStrings(groups[group], `group ${group}`),
      );
      return { mode, groups: selections, packages: unique(selectedPackages) };
    }
    case 'package': {
      requireSelections(mode, selections);
      const supportedPackages = new Set(packages);
      const unknownPackage = selections.find(
        (packageName) => !supportedPackages.has(packageName),
      );
      if (unknownPackage !== undefined) {
        throw new TypeError(`Unknown package: ${unknownPackage}.`);
      }
      return { mode, packages: unique(selections) };
    }
    default:
      throw new TypeError(`Unknown target mode: ${mode}.`);
  }
};

const renderPackageCatalog = () => {
  const rows = Object.entries(groups).map(([group, members]) => {
    const description = groupDescriptions[group];
    if (typeof description !== 'string') {
      throw new TypeError(`Missing description for group ${group}.`);
    }
    const packageNames = readStrings(members, `group ${group}`)
      .map(publicName)
      .join(', ');
    return `| ${group} | ${description} | ${packageNames} |`;
  });
  return [
    '| 패키지군 | 설명 | 포함 패키지 |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n');
};

const renderPurposeCatalog = () => {
  const rows = Object.entries(purposes).map(([purpose, reviewers]) => {
    const description = purposeDescriptions[purpose];
    if (typeof description !== 'string') {
      throw new TypeError(`Missing description for purpose ${purpose}.`);
    }
    return `| ${purpose} | ${description} | ${readStrings(
      reviewers,
      `purpose ${purpose}`,
    ).join(', ')} |`;
  });
  return [
    '| 감사 목적 | 살펴보는 내용 | 실행 reviewer |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n');
};

const [command, ...arguments_] = process.argv.slice(2);

switch (command) {
  case 'modes':
    console.log(JSON.stringify(targetModes, null, 2));
    break;
  case 'packages':
    console.log(renderPackageCatalog());
    break;
  case 'purposes':
    console.log(renderPurposeCatalog());
    break;
  case 'resolve': {
    const [mode, ...selections] = arguments_;
    if (mode === undefined) {
      throw new TypeError('resolve requires a target mode.');
    }
    console.log(JSON.stringify(resolveScope(mode, selections), null, 2));
    break;
  }
  default:
    throw new TypeError(
      'Usage: intake.mjs <modes|packages|purposes|resolve MODE [SELECTION...]>.',
    );
}
