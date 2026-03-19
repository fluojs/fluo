import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { KonektiError } from '@konekti/core';

import type { ConfigDictionary, ConfigLoadOptions } from './types.js';

/**
 * `.env` 파일 내용을 단순한 key-value 맵으로 파싱한다.
 */
function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');

    if (equalsIndex === -1) {
      console.warn(`[config] Skipping malformed .env line (missing '='): ${trimmed}`);
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();

    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    parsed[key] = value;
  }

  return parsed;
}

/**
 * 정해진 우선순서에 따라 설정을 병합하고 검증한다.
 */
export function loadConfig(options: ConfigLoadOptions): ConfigDictionary {
  const cwd = options.cwd ?? process.cwd();
  const envFile = options.envFile ?? join(cwd, `.env.${options.mode}`);
  const defaults = options.defaults ?? {};
  const processEnv = options.processEnv ?? process.env;
  const runtimeOverrides = options.runtimeOverrides ?? {};

  const envFileValues = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {};

  const merged: ConfigDictionary = {
    ...defaults,
    ...envFileValues,
    ...processEnv,
    ...runtimeOverrides,
  };

  try {
    return options.validate ? options.validate(merged) : merged;
  } catch (error: unknown) {
    throw new KonektiError('Invalid configuration.', {
      code: 'INVALID_CONFIG',
      cause: error,
    });
  }
}
