import type { MetadataPropertyKey } from '@fluojs/core';
import type { ComponentType, ReactNode } from 'react';

import { getReactPathMetadata, getReactRouterMetadata } from './decorators.js';
import type { ReactRenderContext } from './render.js';
import {
  createReactRenderPolicyDecorator,
  getReactRenderPolicySites,
  type ReactRenderPolicyDecorator,
  type ReactRenderPolicyRecord,
  type ReactRenderPolicySite,
} from './render-policy-metadata.js';

/** Stable bootstrap diagnostic codes for invalid React render policy declarations. */
export const REACT_RENDER_POLICY_DIAGNOSTIC_CODES = {
  duplicatePageLayout: 'react-render-policy-duplicate-page-layout',
  duplicateSuspenseFallback: 'react-render-policy-duplicate-suspense-fallback',
  invalidReference: 'react-render-policy-invalid-reference',
  invalidTarget: 'react-render-policy-invalid-target',
  missingPageRenderer: 'react-render-policy-missing-page-renderer',
} as const;

/** Stable code attached to a React render policy bootstrap diagnostic. */
export type ReactRenderPolicyDiagnosticCode = (
  typeof REACT_RENDER_POLICY_DIAGNOSTIC_CODES
)[keyof typeof REACT_RENDER_POLICY_DIAGNOSTIC_CODES];

/** Props supplied to a page layout component by an application page renderer. */
export type ReactPageLayoutProps = {
  /** Page or nested layout content composed at this policy level. */
  readonly children: ReactNode;
  /** Active request-scoped React render context. */
  readonly context: ReactRenderContext;
};

/** React component reference used to compose one page layout policy. */
export type ReactPageLayout = ComponentType<ReactPageLayoutProps>;

/** Props supplied to an SSR Suspense fallback component by an application page renderer. */
export type ReactSuspenseFallbackProps = {
  /** Active request-scoped React render context. */
  readonly context: ReactRenderContext;
};

/** React component reference used as an SSR Suspense fallback. */
export type ReactSuspenseFallback = ComponentType<ReactSuspenseFallbackProps>;

/** Resolved render policies passed to the configured application page renderer. */
export type ReactRenderPolicies = {
  /** Layout references ordered from outermost class policy to innermost method policy. */
  readonly layouts: readonly ReactPageLayout[];
  /** Nearest method- or class-level SSR Suspense fallback reference. */
  readonly suspenseFallback?: ReactSuspenseFallback;
};

/** Typed bootstrap failure for an invalid React render policy declaration. */
export class ReactRenderPolicyConfigurationError extends Error {
  override readonly name = 'ReactRenderPolicyConfigurationError';

  /** Stable machine-readable diagnostic code. */
  readonly code: ReactRenderPolicyDiagnosticCode;

  /** Class or class-method label that owns the invalid declaration. */
  readonly target: string;

  /**
   * Creates a render policy bootstrap diagnostic.
   *
   * @param code Stable diagnostic code for the invalid declaration.
   * @param target Class or class-method label that owns the declaration.
   */
  constructor(code: ReactRenderPolicyDiagnosticCode, target: string) {
    super(`${code}: ${target}`);
    this.code = code;
    this.target = target;
  }
}

function siteTarget(site: ReactRenderPolicySite): string {
  const className = site.owner.name || '<anonymous>';
  return site.kind === 'class' ? className : `${className}.${String(site.propertyKey)}`;
}

function recordsForKind(
  records: readonly ReactRenderPolicyRecord[],
  kind: ReactRenderPolicyRecord['kind'],
): readonly ReactRenderPolicyRecord[] {
  return records.filter((record) => record.kind === kind);
}

function isPageLayoutReference(value: unknown): value is ReactPageLayout {
  return typeof value === 'function';
}

function isSuspenseFallbackReference(value: unknown): value is ReactSuspenseFallback {
  return typeof value === 'function';
}

function readPageLayout(site: ReactRenderPolicySite): ReactPageLayout | undefined {
  const records = recordsForKind(site.records, 'layout');
  if (records.length > 1) {
    throw new ReactRenderPolicyConfigurationError(
      REACT_RENDER_POLICY_DIAGNOSTIC_CODES.duplicatePageLayout,
      siteTarget(site),
    );
  }

  const reference = records[0]?.reference;
  if (reference === undefined) {
    return undefined;
  }
  if (!isPageLayoutReference(reference)) {
    throw new ReactRenderPolicyConfigurationError(
      REACT_RENDER_POLICY_DIAGNOSTIC_CODES.invalidReference,
      siteTarget(site),
    );
  }
  return reference;
}

function readSuspenseFallback(site: ReactRenderPolicySite): ReactSuspenseFallback | undefined {
  const records = recordsForKind(site.records, 'suspense-fallback');
  if (records.length > 1) {
    throw new ReactRenderPolicyConfigurationError(
      REACT_RENDER_POLICY_DIAGNOSTIC_CODES.duplicateSuspenseFallback,
      siteTarget(site),
    );
  }

  const reference = records[0]?.reference;
  if (reference === undefined) {
    return undefined;
  }
  if (!isSuspenseFallbackReference(reference)) {
    throw new ReactRenderPolicyConfigurationError(
      REACT_RENDER_POLICY_DIAGNOSTIC_CODES.invalidReference,
      siteTarget(site),
    );
  }
  return reference;
}

function assertValidPolicyTarget(site: ReactRenderPolicySite): void {
  const valid = site.kind === 'class'
    ? getReactRouterMetadata(site.owner) !== undefined
    : getReactPathMetadata(site.owner, site.propertyKey) !== undefined;

  if (!valid) {
    throw new ReactRenderPolicyConfigurationError(
      REACT_RENDER_POLICY_DIAGNOSTIC_CODES.invalidTarget,
      siteTarget(site),
    );
  }
}

/**
 * Marks a React router class or `@Path(...)` method with one layout component reference.
 *
 * @param layout Layout component reference consumed by the configured application page renderer.
 * @returns A class-or-method decorator that records render-only metadata without changing HTTP matching.
 */
export function PageLayout(layout: ReactPageLayout): ReactRenderPolicyDecorator {
  return createReactRenderPolicyDecorator('layout', layout);
}

/**
 * Marks a React router class or `@Path(...)` method with one SSR Suspense fallback component reference.
 *
 * @param fallback Fallback component reference consumed by the configured application page renderer.
 * @returns A class-or-method decorator that records render-only metadata without changing HTTP matching.
 */
export function SuspenseFallback(fallback: ReactSuspenseFallback): ReactRenderPolicyDecorator {
  return createReactRenderPolicyDecorator('suspense-fallback', fallback);
}

/**
 * Resolves inherited class and method render policies for one React page handler.
 *
 * @param routerToken React router class containing the matched page handler.
 * @param propertyKey Matched `@Path(...)` method property key.
 * @returns A defensive renderer-facing policy snapshot in outer-to-inner composition order.
 */
export function getReactRenderPolicies(
  routerToken: Function,
  propertyKey: MetadataPropertyKey,
): ReactRenderPolicies {
  const sites = getReactRenderPolicySites(routerToken);
  const relevantSites = sites.filter((site) => site.kind === 'class' || site.propertyKey === propertyKey);
  const layouts: ReactPageLayout[] = [];
  let suspenseFallback: ReactSuspenseFallback | undefined;

  for (const site of relevantSites) {
    const layout = readPageLayout(site);
    const fallback = readSuspenseFallback(site);
    if (layout !== undefined) {
      layouts.push(layout);
    }
    if (fallback !== undefined) {
      suspenseFallback = fallback;
    }
  }

  return {
    layouts,
    ...(suspenseFallback === undefined ? {} : { suspenseFallback }),
  };
}

/**
 * Validates registered router policy declarations before request dispatch begins.
 *
 * @param routerTokens React module controller tokens inspected at bootstrap.
 * @param hasPageRenderer Whether the module registered an application page renderer.
 * @returns Nothing when every declaration is valid.
 */
export function validateReactRenderPolicyControllers(
  routerTokens: readonly Function[],
  hasPageRenderer: boolean,
): void {
  for (const routerToken of routerTokens) {
    const sites = getReactRenderPolicySites(routerToken);
    if (sites.length === 0) {
      continue;
    }
    if (!hasPageRenderer) {
      throw new ReactRenderPolicyConfigurationError(
        REACT_RENDER_POLICY_DIAGNOSTIC_CODES.missingPageRenderer,
        routerToken.name || '<anonymous>',
      );
    }

    for (const site of sites) {
      assertValidPolicyTarget(site);
      readPageLayout(site);
      readSuspenseFallback(site);
    }
  }
}
