function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }

  return 0;
}

function parseVersion(value) {
  const rawParts = value.replace(/^v/u, '').split('.');

  if (rawParts.length > 3 || rawParts.length === 0) {
    return null;
  }

  const parts = [0, 0, 0];
  let precision = rawParts.length;
  let hasWildcard = false;

  for (let index = 0; index < rawParts.length; index += 1) {
    const part = rawParts[index];

    if (part === '*' || /^x$/iu.test(part)) {
      hasWildcard = true;
      precision = Math.min(precision, index);
      continue;
    }

    if (hasWildcard || !/^(0|[1-9]\d*)$/u.test(part)) {
      return null;
    }

    parts[index] = Number(part);
  }

  return { parts, precision };
}

function nextPrefix(version, precision = version.precision) {
  if (precision === 0) {
    return null;
  }

  const parts = [...version.parts];
  const incrementIndex = precision - 1;
  parts[incrementIndex] += 1;

  for (let index = incrementIndex + 1; index < parts.length; index += 1) {
    parts[index] = 0;
  }

  return parts;
}

function setLower(interval, bound) {
  if (
    !interval.lower ||
    compareVersions(bound.parts, interval.lower.parts) > 0 ||
    (compareVersions(bound.parts, interval.lower.parts) === 0 && !bound.inclusive)
  ) {
    interval.lower = bound;
  }
}

function setUpper(interval, bound) {
  if (
    !interval.upper ||
    compareVersions(bound.parts, interval.upper.parts) < 0 ||
    (compareVersions(bound.parts, interval.upper.parts) === 0 && !bound.inclusive)
  ) {
    interval.upper = bound;
  }
}

function applyComparator(interval, operator, version) {
  const upper = nextPrefix(version);

  if (operator === '^') {
    const nonZeroIndex = version.parts.findIndex((part) => part !== 0);
    const next = nextPrefix(version, nonZeroIndex === -1 ? version.precision : nonZeroIndex + 1);
    setLower(interval, { inclusive: true, parts: version.parts });
    if (next) {
      setUpper(interval, { inclusive: false, parts: next });
    }
    return;
  }

  if (operator === '~') {
    const next = nextPrefix(version, Math.min(Math.max(version.precision, 1), 2));
    setLower(interval, { inclusive: true, parts: version.parts });
    if (next) {
      setUpper(interval, { inclusive: false, parts: next });
    }
    return;
  }

  if (operator === '' || operator === '=') {
    setLower(interval, { inclusive: true, parts: version.parts });
    if (version.precision === 3) {
      setUpper(interval, { inclusive: true, parts: version.parts });
    } else if (upper) {
      setUpper(interval, { inclusive: false, parts: upper });
    }
    return;
  }

  if (operator === '>') {
    setLower(interval, {
      inclusive: version.precision < 3,
      parts: version.precision < 3 ? nextPrefix(version) : version.parts,
    });
    return;
  }

  if (operator === '>=') {
    setLower(interval, { inclusive: true, parts: version.parts });
    return;
  }

  if (operator === '<') {
    setUpper(interval, { inclusive: false, parts: version.parts });
    return;
  }

  if (operator === '<=') {
    if (version.precision === 3) {
      setUpper(interval, { inclusive: true, parts: version.parts });
    } else if (upper) {
      setUpper(interval, { inclusive: false, parts: upper });
    }
  }
}

function isValid(interval) {
  if (!interval.lower || !interval.upper) {
    return true;
  }

  const comparison = compareVersions(interval.lower.parts, interval.upper.parts);
  return comparison < 0 || (comparison === 0 && interval.lower.inclusive && interval.upper.inclusive);
}

function parseClause(clause) {
  const trimmed = clause.trim();
  const hyphen = /^(\S+)\s+-\s+(\S+)$/u.exec(trimmed);
  const interval = { lower: null, upper: null };

  if (hyphen) {
    const lower = parseVersion(hyphen[1]);
    const upper = parseVersion(hyphen[2]);

    if (!lower || !upper) {
      return null;
    }

    setLower(interval, { inclusive: true, parts: lower.parts });
    const next = nextPrefix(upper);
    if (upper.precision === 3) {
      setUpper(interval, { inclusive: true, parts: upper.parts });
    } else if (next) {
      setUpper(interval, { inclusive: false, parts: next });
    }
    return isValid(interval) ? interval : null;
  }

  for (const token of trimmed.split(/\s+/u)) {
    const match = /^(<=|>=|<|>|=|~|\^)?(v?[\d*xX][\d*xX.]*)$/u.exec(token);
    const version = match ? parseVersion(match[2]) : null;

    if (!match || !version) {
      return null;
    }

    applyComparator(interval, match[1] ?? '', version);
  }

  return isValid(interval) ? interval : null;
}

function compareLower(left, right) {
  if (!left) return right ? -1 : 0;
  if (!right) return 1;
  const comparison = compareVersions(left.parts, right.parts);
  return comparison === 0 && left.inclusive !== right.inclusive ? (left.inclusive ? -1 : 1) : comparison;
}

function overlaps(left, right) {
  if (!left.upper || !right.lower) return true;
  const comparison = compareVersions(left.upper.parts, right.lower.parts);
  return comparison > 0 || (comparison === 0 && (left.upper.inclusive || right.lower.inclusive));
}

function merge(left, right) {
  if (!left.upper || !right.upper) return { lower: left.lower, upper: null };
  const comparison = compareVersions(left.upper.parts, right.upper.parts);
  return {
    lower: left.lower,
    upper: comparison > 0 || (comparison === 0 && left.upper.inclusive) ? left.upper : right.upper,
  };
}

function normalizeRange(range) {
  const intervals = range
    .split('||')
    .map((clause) => parseClause(clause))
    .sort((left, right) => (left && right ? compareLower(left.lower, right.lower) : 0));

  if (intervals.some((interval) => interval === null)) return null;

  return intervals.reduce((merged, interval) => {
    const previous = merged.at(-1);
    if (!previous || !overlaps(previous, interval)) {
      merged.push(interval);
    } else {
      merged[merged.length - 1] = merge(previous, interval);
    }
    return merged;
  }, []);
}

function contains(container, candidate) {
  if (container.lower && (!candidate.lower || compareLower(container.lower, candidate.lower) > 0)) return false;
  if (container.upper && !candidate.upper) return false;
  if (container.upper && candidate.upper) {
    const comparison = compareVersions(container.upper.parts, candidate.upper.parts);
    if (comparison < 0 || (comparison === 0 && !container.upper.inclusive && candidate.upper.inclusive)) {
      return false;
    }
  }
  return true;
}

function isSubset(candidate, previous) {
  return candidate.every((interval) => previous.some((container) => contains(container, interval)));
}

function versionTier(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(version);

  if (!match) {
    return 'invalid';
  }

  return Number(match[1]) === 0 || match[4] ? 'preview' : 'official';
}

export function narrowsStableNodeEngineRange(previousVersion, previousRange, nextRange, nextVersion = previousVersion) {
  const previousTier = versionTier(previousVersion);
  const nextTier = versionTier(nextVersion);

  if (previousTier !== 'official' || nextTier === 'preview' || previousRange === nextRange) {
    return false;
  }

  if (nextTier !== 'official') {
    return true;
  }

  const previous = normalizeRange(previousRange ?? '*');
  const next = normalizeRange(nextRange ?? '*');

  if (!previous || !next) {
    return true;
  }

  return !isSubset(previous, next);
}
