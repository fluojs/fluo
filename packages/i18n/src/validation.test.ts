import { describe, expect, it } from 'vitest';

import { DefaultValidator, DtoValidationError, IsEmail, IsString, MinLength } from '@fluojs/validation';

import { createI18n } from './index.js';
import { I18nError } from './errors.js';
import {
  createValidationIssueTranslationKeys,
  localizeDtoValidationError,
  localizeValidationIssues,
} from './validation.js';
import type { LocalizeValidationIssuesOptions, ValidationIssueTranslationKeyBuilder } from './validation.js';

class CreateUserDto {
  @IsEmail()
  email = '';

  @IsString()
  @MinLength(3)
  name = '';
}

async function collectValidationError(): Promise<DtoValidationError> {
  const validator = new DefaultValidator();

  try {
    await validator.materialize({ email: 'bad-email', name: 'x' }, CreateUserDto);
  } catch (error) {
    if (error instanceof DtoValidationError) {
      return error;
    }
  }

  throw new Error('Expected validation to fail.');
}

describe('@fluojs/i18n/validation localized validation errors', () => {
  it('keeps validation messages unchanged until applications explicitly localize them', async () => {
    const error = await collectValidationError();

    expect(error.issues).toEqual([
      { code: 'EMAIL', field: 'email', message: 'email is invalid.', source: undefined },
      { code: 'MIN_LENGTH', field: 'name', message: 'name must have length at least 3.', source: undefined },
    ]);
  });

  it('localizes validation issues through field/code translation keys', async () => {
    const error = await collectValidationError();
    const i18n = createI18n({
      catalogs: {
        en: {
          validation: {
            email: {
              EMAIL: '{{ field }} must be a deliverable email address.',
            },
            name: {
              MIN_LENGTH: '{{ field }} is too short.',
            },
          },
        },
        ko: {
          validation: {
            email: {
              EMAIL: '{{ field }}에는 올바른 이메일 주소가 필요합니다.',
            },
            name: {
              MIN_LENGTH: '{{ field }}의 길이가 너무 짧습니다.',
            },
          },
        },
      },
      defaultLocale: 'en',
      fallbackLocales: { ko: ['en'] },
      supportedLocales: ['en', 'ko'],
    });

    const localized = localizeDtoValidationError(i18n, error, { locale: 'ko' });

    expect(localized).toBeInstanceOf(DtoValidationError);
    expect(localized).not.toBe(error);
    expect(localized.message).toBe('Validation failed.');
    expect(localized.issues).toEqual([
      { code: 'EMAIL', field: 'email', message: 'email에는 올바른 이메일 주소가 필요합니다.', source: undefined },
      { code: 'MIN_LENGTH', field: 'name', message: 'name의 길이가 너무 짧습니다.', source: undefined },
    ]);
    expect(error.issues[0]?.message).toBe('email is invalid.');
  });

  it('falls back through i18n catalogs and then preserves original messages for missing translations', async () => {
    const error = await collectValidationError();
    const i18n = createI18n({
      catalogs: {
        en: {
          validation: {
            name: {
              MIN_LENGTH: 'Default {{ field }} length message.',
            },
          },
        },
        ko: {
          validation: {},
        },
      },
      defaultLocale: 'en',
      fallbackLocales: { ko: ['en'] },
      supportedLocales: ['en', 'ko'],
    });

    expect(localizeValidationIssues(i18n, error.issues, { locale: 'ko' })).toEqual([
      { code: 'EMAIL', field: 'email', message: 'email is invalid.', source: undefined },
      { code: 'MIN_LENGTH', field: 'name', message: 'Default name length message.', source: undefined },
    ]);
  });

  it('can make missing validation translations fail explicitly', async () => {
    const error = await collectValidationError();
    const i18n = createI18n({
      catalogs: { en: { validation: {} } },
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });

    expect(() => localizeValidationIssues(i18n, error.issues, { fallbackToIssueMessage: false, locale: 'en' })).toThrow(I18nError);
  });

  it('supports source/path-specific keys, key prefixes, namespaces, and custom key builders', () => {
    const i18n = createI18n({
      catalogs: {
        en: {
          errors: {
            request: {
              body: {
                'items[0]': {
                  name: {
                    MIN_LENGTH: 'First item name is too short.',
                  },
                },
              },
            },
            custom: {
              CUSTOM_CODE: 'Custom message for {{ field }}.',
            },
          },
        },
      },
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });
    const keyBuilder: ValidationIssueTranslationKeyBuilder = ({ issue }) => [`custom.${issue.code}`];

    expect(
      createValidationIssueTranslationKeys({ code: 'MIN_LENGTH', field: 'items[0].name', message: 'fallback', source: 'body' }, 'request'),
    ).toEqual([
      'request.body.items[0].name.MIN_LENGTH',
      'request.items[0].name.MIN_LENGTH',
      'request.body.MIN_LENGTH',
      'request.MIN_LENGTH',
    ]);
    expect(
      localizeValidationIssues(
        i18n,
        [{ code: 'MIN_LENGTH', field: 'items[0].name', message: 'fallback', source: 'body' }],
        { keyPrefix: 'request', locale: 'en', namespace: 'errors' },
      ),
    ).toEqual([{ code: 'MIN_LENGTH', field: 'items[0].name', message: 'First item name is too short.', source: 'body' }]);
    expect(
      localizeValidationIssues(
        i18n,
        [{ code: 'CUSTOM_CODE', field: 'profile', message: 'fallback' }],
        { keyBuilder, locale: 'en', namespace: 'errors' },
      ),
    ).toEqual([{ code: 'CUSTOM_CODE', field: 'profile', message: 'Custom message for profile.' }]);
  });

  it('exposes the validation subpath without adding validation helpers to the root entry point', async () => {
    const root = await import('./index.js');
    const validation = await import('./validation.js');
    const options: LocalizeValidationIssuesOptions = { locale: 'en' };

    expect(options.locale).toBe('en');
    expect(Object.keys(root).sort()).toEqual(['I18nError', 'I18nModule', 'I18nService', 'createI18n']);
    expect(Object.keys(validation).sort()).toEqual([
      'createValidationIssueTranslationKeys',
      'localizeDtoValidationError',
      'localizeValidationIssue',
      'localizeValidationIssues',
    ]);
  });
});
