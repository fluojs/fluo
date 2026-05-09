import { defineI18n } from 'fumadocs-core/i18n';

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'ko'],
});

export type DocsLanguage = (typeof i18n.languages)[number];

export function isDocsLanguage(value: string): value is DocsLanguage {
  return i18n.languages.includes(value as DocsLanguage);
}
