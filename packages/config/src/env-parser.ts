function unquoteEnvValue(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const quote = value[0];
  if ((quote !== '"' && quote !== "'" && quote !== '`') || value[value.length - 1] !== quote) {
    return value;
  }

  const unquoted = value.slice(1, -1);
  return quote === '"' ? unquoted.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : unquoted;
}

function stripInlineEnvComment(value: string): string {
  const commentIndex = value.indexOf('#');
  return commentIndex === -1 ? value : value.slice(0, commentIndex);
}

function findClosingEnvQuote(value: string, quote: string): number {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === quote && value[index - 1] !== '\\') {
      return index;
    }
  }

  return -1;
}

function collectQuotedEnvValue(lines: readonly string[], startIndex: number, valueStart: string, quote: string): { nextIndex: number; value: string } {
  let value = valueStart;
  let currentIndex = startIndex;

  while (currentIndex + 1 < lines.length && findClosingEnvQuote(value, quote) === -1) {
    currentIndex += 1;
    value += `\n${lines[currentIndex]}`;
  }

  const closingQuoteIndex = findClosingEnvQuote(value, quote);

  return {
    nextIndex: currentIndex,
    value: closingQuoteIndex === -1 ? value : value.slice(0, closingQuoteIndex + 1),
  };
}

/**
 * Parses dotenv assignments, quotes, and multiline values without runtime I/O.
 *
 * @internal
 * @param content Env-file text.
 * @returns Parsed values before variable expansion.
 */
export function parseDotenvContent(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const entry = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const separatorIndex = entry.search(/[:=]/);
    if (separatorIndex <= 0) {
      continue;
    }

    const key = entry.slice(0, separatorIndex).trim();
    const rawValue = entry.slice(separatorIndex + 1).trim();
    if (!/^[\w.-]+$/.test(key)) {
      continue;
    }

    const quote = rawValue[0];
    const quotedValue = quote === '"' || quote === "'" || quote === '`';
    const collected = quotedValue ? collectQuotedEnvValue(lines, index, rawValue, quote) : { nextIndex: index, value: stripInlineEnvComment(rawValue).trim() };

    index = collected.nextIndex;
    parsed[key] = unquoteEnvValue(collected.value);
  }

  return parsed;
}
