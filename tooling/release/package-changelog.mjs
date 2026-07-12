const unreleasedHeading = '## [Unreleased]';
const unreleasedCandidatePattern = /^[\t ]*#{1,6}[\t ]*\[Unreleased\].*$/u;

export class PackageChangelogContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PackageChangelogContractError';
  }
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === '') {
    start += 1;
  }

  while (end > start && lines[end - 1].trim() === '') {
    end -= 1;
  }

  return lines.slice(start, end);
}

function openingFence(line) {
  const trimmed = line.trimStart();
  const character = trimmed[0];

  if (character !== '`' && character !== '~') {
    return undefined;
  }

  let length = 0;
  while (trimmed[length] === character) {
    length += 1;
  }

  return length >= 3 ? { character, length } : undefined;
}

function closesFence(line, fence) {
  const trimmed = line.trim();
  return trimmed.length >= fence.length && [...trimmed].every((character) => character === fence.character);
}

function parsePackageChangelog(changelog) {
  const lines = changelog.trimEnd().split(/\r?\n/u);

  if (!/^# (?!#)/u.test(lines[0] ?? '')) {
    throw new PackageChangelogContractError('Package CHANGELOG.md must start with a level-one package title.');
  }

  const h2Indexes = [];
  const unreleasedIndexes = [];
  const malformedUnreleasedIndexes = [];
  let activeFence;

  for (const [index, line] of lines.entries()) {
    if (activeFence) {
      if (closesFence(line, activeFence)) {
        activeFence = undefined;
      }
      continue;
    }

    const fence = openingFence(line);
    if (fence) {
      activeFence = fence;
      continue;
    }

    if (/^##(?!#)(?:[\t ]|$)/u.test(line)) {
      h2Indexes.push(index);
    }

    if (line === unreleasedHeading) {
      unreleasedIndexes.push(index);
    } else if (unreleasedCandidatePattern.test(line)) {
      malformedUnreleasedIndexes.push(index);
    }
  }

  if (malformedUnreleasedIndexes.length > 0) {
    throw new PackageChangelogContractError(
      'Package CHANGELOG.md must use the exact standalone `## [Unreleased]` heading.',
    );
  }

  if (unreleasedIndexes.length > 1) {
    throw new PackageChangelogContractError(
      'Package CHANGELOG.md must contain at most one `## [Unreleased]` section.',
    );
  }

  return { h2Indexes, lines, unreleasedIndex: unreleasedIndexes[0] };
}

export function packageChangelogContractViolation(changelog) {
  let parsed;

  try {
    parsed = parsePackageChangelog(changelog);
  } catch (error) {
    if (error instanceof PackageChangelogContractError) {
      return error.message;
    }
    throw error;
  }

  if (parsed.unreleasedIndex === undefined) {
    return 'Package CHANGELOG.md must contain exactly one standalone `## [Unreleased]` section.';
  }

  const contentBeforeUnreleased = parsed.lines.slice(1, parsed.unreleasedIndex);
  if (contentBeforeUnreleased.some((line) => line.trim() !== '')) {
    return 'Package CHANGELOG.md must place `## [Unreleased]` immediately below the package title.';
  }

  return undefined;
}

export function normalizePackageChangelog(changelog) {
  const { h2Indexes, lines, unreleasedIndex } = parsePackageChangelog(changelog);
  let unreleasedBody = [];
  let remainingLines = lines;

  if (unreleasedIndex !== undefined) {
    const sectionEnd = h2Indexes.find((index) => index > unreleasedIndex) ?? lines.length;
    unreleasedBody = trimBlankEdges(lines.slice(unreleasedIndex + 1, sectionEnd));
    remainingLines = [...lines.slice(0, unreleasedIndex), ...lines.slice(sectionEnd)];
  }

  const title = remainingLines.slice(0, 1);
  const releaseHistory = trimBlankEdges(remainingLines.slice(1));

  return [
    ...title,
    '',
    unreleasedHeading,
    ...(unreleasedBody.length > 0 ? ['', ...unreleasedBody] : []),
    ...(releaseHistory.length > 0 ? ['', ...releaseHistory] : []),
    '',
  ].join('\n');
}
