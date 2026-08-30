function compareNodeVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }

  return 0;
}

function parseNodeVersion(value) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u.exec(value);

  if (!match) {
    return null;
  }

  return {
    parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    precision: match[3] === undefined ? (match[2] === undefined ? 1 : 2) : 3,
  };
}

function nextPartialVersion(version) {
  const parts = [...version.parts];
  const incrementIndex = version.precision - 1;
  parts[incrementIndex] += 1;

  for (let index = incrementIndex + 1; index < parts.length; index += 1) {
    parts[index] = 0;
  }

  return parts;
}

function setLowerBound(interval, bound) {
  if (!interval.lower || compareNodeVersions(bound.parts, interval.lower.parts) > 0) {
    interval.lower = bound;
  }
}

function setUpperBound(interval, bound) {
  if (!interval.upper || compareNodeVersions(bound.parts, interval.upper.parts) < 0) {
    interval.upper = bound;
  }
}

function parseNodeEngineClause(clause) {
  const interval = { lower: null, upper: null };

  for (const token of clause.trim().split(/\s+/u)) {
    const match = /^(>=|>|<=|<|=)?(v?\d+(?:\.\d+){0,2})$/u.exec(token);

    if (!match) {
      return null;
    }

    const version = parseNodeVersion(match[2]);

    if (!version) {
      return null;
    }

    const operator = match[1] ?? '';

    if (operator === '') {
      if (version.precision < 3) {
        setLowerBound(interval, { inclusive: true, parts: version.parts });
        setUpperBound(interval, { inclusive: false, parts: nextPartialVersion(version) });
      } else {
        setLowerBound(interval, { inclusive: true, parts: version.parts });
        setUpperBound(interval, { inclusive: true, parts: version.parts });
      }
    } else if (operator === '>' || operator === '>=') {
      setLowerBound(interval, { inclusive: operator === '>=', parts: version.parts });
    } else if (operator === '<' || operator === '<=') {
      setUpperBound(interval, { inclusive: operator === '<=', parts: version.parts });
    } else {
      setLowerBound(interval, { inclusive: true, parts: version.parts });
      setUpperBound(interval, { inclusive: true, parts: version.parts });
    }
  }

  if (!interval.lower || !interval.upper) {
    return interval;
  }

  const comparison = compareNodeVersions(interval.lower.parts, interval.upper.parts);

  return comparison < 0 || (comparison === 0 && interval.lower.inclusive && interval.upper.inclusive)
    ? interval
    : null;
}

function compareLowerBounds(left, right) {
  if (!left) {
    return right ? -1 : 0;
  }

  if (!right) {
    return 1;
  }

  const comparison = compareNodeVersions(left.parts, right.parts);

  return comparison === 0 && left.inclusive !== right.inclusive ? (left.inclusive ? -1 : 1) : comparison;
}

function intervalsOverlap(left, right) {
  if (!left.upper || !right.lower) {
    return true;
  }

  const comparison = compareNodeVersions(left.upper.parts, right.lower.parts);

  return comparison > 0 || (comparison === 0 && (left.upper.inclusive || right.lower.inclusive));
}

function mergeIntervals(left, right) {
  if (!left.upper || !right.upper) {
    return { lower: left.lower, upper: null };
  }

  const comparison = compareNodeVersions(left.upper.parts, right.upper.parts);

  return {
    lower: left.lower,
    upper:
      comparison > 0 || (comparison === 0 && left.upper.inclusive)
        ? left.upper
        : right.upper,
  };
}

function normalizeNodeEngineRange(range) {
  const parsedIntervals = range.split('||').map((clause) => parseNodeEngineClause(clause));

  if (parsedIntervals.length === 0 || parsedIntervals.some((interval) => interval === null)) {
    return null;
  }

  const intervals = parsedIntervals.sort((left, right) => compareLowerBounds(left.lower, right.lower));

  return intervals.reduce((merged, interval) => {
    const previous = merged.at(-1);

    if (!previous || !intervalsOverlap(previous, interval)) {
      merged.push(interval);
      return merged;
    }

    merged[merged.length - 1] = mergeIntervals(previous, interval);
    return merged;
  }, []);
}

function containsInterval(container, candidate) {
  if (container.lower && !candidate.lower) {
    return false;
  }

  if (container.lower && candidate.lower) {
    const lowerComparison = compareNodeVersions(container.lower.parts, candidate.lower.parts);

    if (
      lowerComparison > 0 ||
      (lowerComparison === 0 && !container.lower.inclusive && candidate.lower.inclusive)
    ) {
      return false;
    }
  }

  if (container.upper && !candidate.upper) {
    return false;
  }

  if (container.upper && candidate.upper) {
    const upperComparison = compareNodeVersions(container.upper.parts, candidate.upper.parts);

    if (
      upperComparison < 0 ||
      (upperComparison === 0 && !container.upper.inclusive && candidate.upper.inclusive)
    ) {
      return false;
    }
  }

  return true;
}

function isSubset(candidate, previous) {
  return candidate.every((candidateInterval) =>
    previous.some((previousInterval) => containsInterval(previousInterval, candidateInterval)),
  );
}

export function narrowsStableNodeEngineRange(previousVersion, previousRange, nextRange) {
  const previousMajorVersion = /^(\d+)\./u.exec(previousVersion);

  if (!previousMajorVersion || Number(previousMajorVersion[1]) === 0 || previousRange === nextRange) {
    return false;
  }

  const previous = normalizeNodeEngineRange(previousRange);
  const next = normalizeNodeEngineRange(nextRange);

  return previous !== null && next !== null && isSubset(next, previous) && !isSubset(previous, next);
}
