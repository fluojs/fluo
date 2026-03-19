import { existsSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';

import { KonektiError } from '@konekti/core';
import { parse as dotenvParse } from 'dotenv';
import { expand as dotenvExpand } from 'dotenv-expand';

import type { ConfigDictionary, ConfigLoadOptions } from './types.js';

function parseEnvContent(content: string, processEnv: NodeJS.ProcessEnv, customParser?: (content: string) => Record<string, string>): Record<string, string> {
  if (customParser) {
    return customParser(content);
  }
  const parsed = dotenvParse(content);
  const safeProcessEnv: Record<string, string> = Object.fromEntries(
    Object.entries(processEnv).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const result = dotenvExpand({ parsed, processEnv: safeProcessEnv });
  return result.parsed ?? {};
}

export function loadConfig(options: ConfigLoadOptions): ConfigDictionary {
  const cwd = options.cwd ?? process.cwd();
  const envFile = options.envFile ?? join(cwd, `.env.${options.mode}`);
  const defaults = options.defaults ?? {};
  const processEnv = options.processEnv ?? process.env;
  const runtimeOverrides = options.runtimeOverrides ?? {};

  const envFileValues = existsSync(envFile)
    ? parseEnvContent(readFileSync(envFile, 'utf8'), processEnv, options.parse)
    : {};

  const merged: ConfigDictionary = {
    ...defaults,
    ...envFileValues,
    ...processEnv,
    ...runtimeOverrides,
  };

  let validated: ConfigDictionary;

  try {
    validated = options.validate ? options.validate(merged) : merged;
  } catch (error: unknown) {
    throw new KonektiError('Invalid configuration.', {
      code: 'INVALID_CONFIG',
      cause: error,
    });
  }

  if (options.watch && existsSync(envFile)) {
    watch(envFile, { persistent: false }, () => {
      try {
        const reloaded = parseEnvContent(readFileSync(envFile, 'utf8'), processEnv, options.parse);
        const mergedReloaded: ConfigDictionary = {
          ...defaults,
          ...reloaded,
          ...processEnv,
          ...runtimeOverrides,
        };
        const result = options.validate ? options.validate(mergedReloaded) : mergedReloaded;
        process.emit('CONFIG_RELOADED' as never, result as never);
      } catch {
        // silently skip reload errors — watch mode is best-effort
      }
    });
  }

  return validated;
}
