import { i18n } from '@/lib/i18n';
import { defineI18nUI } from 'fumadocs-ui/i18n';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const i18nUI = defineI18nUI(i18n, {
  en: {
    displayName: 'English',
  },
  ko: {
    displayName: '한국어',
    toc: '목차',
    search: '문서 검색',
    lastUpdate: '마지막 업데이트',
    searchNoResult: '검색 결과가 없습니다',
    previousPage: '이전 페이지',
    nextPage: '다음 페이지',
    chooseLanguage: '언어 선택',
  },
});

const labels = {
  en: {
    title: 'fluo Docs',
  },
  ko: {
    title: 'fluo 문서',
  },
} as const;

export function baseOptions(locale: string): BaseLayoutProps {
  const language = locale === 'ko' ? 'ko' : 'en';
  const text = labels[language];

  return {
    nav: {
      title: text.title,
      url: `/${language}/docs`,
    },
  };
}
