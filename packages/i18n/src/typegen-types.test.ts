import { describe, expectTypeOf, it } from 'vitest';

import type { I18nTranslateOptions } from './types.js';

type AppI18nKey = 'admin/common.dashboard.title' | 'admin/common.dashboard.subtitle' | 'common.cancel';
type AppI18nNamespace = 'admin/common' | 'common';

interface AppI18nKeyByNamespace {
  readonly 'admin/common': 'dashboard.title' | 'dashboard.subtitle';
  readonly common: 'cancel';
}

type AppI18nNamespaceKey<Namespace extends AppI18nNamespace> = AppI18nKeyByNamespace[Namespace];
type AppI18nTypedTranslateOptions = Omit<I18nTranslateOptions, 'namespace'>;
type AppI18nTypedTranslate = <Key extends AppI18nKey>(key: Key, options: AppI18nTypedTranslateOptions) => string;
type HasNamespaceOption<Options> = 'namespace' extends keyof Options ? true : false;
type FullyQualifiedTranslateOptionsHaveNamespace = HasNamespaceOption<Parameters<AppI18nTypedTranslate>[1]>;
type NamespaceScopedHelperOptionsHaveNamespace = HasNamespaceOption<Parameters<AppTypedI18nService['translateInNamespace']>[2]>;
type AdminCommonAllowsDashboardTitle = 'dashboard.title' extends AppI18nNamespaceKey<'admin/common'> ? true : false;
type CommonAllowsDashboardTitle = 'dashboard.title' extends AppI18nNamespaceKey<'common'> ? true : false;

interface AppTypedI18nService {
  readonly translate: AppI18nTypedTranslate;
  readonly translateInNamespace: <Namespace extends AppI18nNamespace, Key extends AppI18nNamespaceKey<Namespace>>(
    namespace: Namespace,
    key: Key,
    options: Omit<I18nTranslateOptions, 'namespace'>,
  ) => string;
}

const typedI18n: AppTypedI18nService = {
  translate: (key, options) => `${options.locale}:${key}`,
  translateInNamespace: (namespace, key, options) => `${options.locale}:${namespace}.${key}`,
};

describe('@fluojs/i18n/typegen typed helper declarations', () => {
  it('supports fully qualified and namespace-scoped translation key callsites', () => {
    const fromFullyQualifiedKey = typedI18n.translate('admin/common.dashboard.title', { locale: 'en' });
    const fromNamespaceScopedKey = typedI18n.translateInNamespace('admin/common', 'dashboard.title', { locale: 'en' });
    const fullyQualifiedOptionsHaveNamespace: FullyQualifiedTranslateOptionsHaveNamespace = false;
    const namespaceScopedOptionsHaveNamespace: NamespaceScopedHelperOptionsHaveNamespace = false;
    const adminCommonSupportsDashboardTitle: AdminCommonAllowsDashboardTitle = true;
    const commonSupportsDashboardTitle: CommonAllowsDashboardTitle = false;

    expectTypeOf(fromFullyQualifiedKey).toEqualTypeOf<string>();
    expectTypeOf(fromNamespaceScopedKey).toEqualTypeOf<string>();
    expectTypeOf(fullyQualifiedOptionsHaveNamespace).toEqualTypeOf<false>();
    expectTypeOf(namespaceScopedOptionsHaveNamespace).toEqualTypeOf<false>();
    expectTypeOf(adminCommonSupportsDashboardTitle).toEqualTypeOf<true>();
    expectTypeOf(commonSupportsDashboardTitle).toEqualTypeOf<false>();
  });
});
