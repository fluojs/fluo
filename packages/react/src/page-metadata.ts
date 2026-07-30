import { createElement, type ReactElement } from 'react';

import type { ReactRenderContext } from './render.js';
import type { ReactRenderPolicies } from './render-policy.js';
import {
  createReactRenderPolicyDecorator,
  type ReactRenderPolicyDecorator,
} from './render-policy-metadata.js';

/** Request-scoped, response-free context supplied to page metadata factories. */
export type ReactPageMetadataContext = {
  readonly container: ReactRenderContext['container'];
  readonly request: ReactRenderContext['request'];
  readonly requestId?: ReactRenderContext['requestId'];
};

/** One name- or property-addressed React document meta descriptor. */
export type ReactPageMeta =
  | {
      readonly content: string;
      readonly name: string;
      readonly property?: never;
    }
  | {
      readonly content: string;
      readonly name?: never;
      readonly property: string;
    };

/** One bounded React document link descriptor. */
export type ReactPageLink = {
  readonly href: string;
  readonly media?: string;
  readonly rel: string;
  readonly type?: string;
};

/** Composed document-head metadata for one matched React page request. */
export type ReactPageMetadata = {
  readonly links?: readonly ReactPageLink[];
  readonly meta?: readonly ReactPageMeta[];
  readonly title?: string;
};

/** Synchronous request-aware factory for one React page metadata declaration. */
export type ReactPageMetadataFactory = (
  context: ReactPageMetadataContext,
) => ReactPageMetadata;

function replaceEntry<Value>(entries: Map<string, Value>, key: string, value: Value): void {
  entries.delete(key);
  entries.set(key, value);
}

function metaIdentity(meta: ReactPageMeta): string {
  return meta.name !== undefined
    ? JSON.stringify(['name', meta.name])
    : JSON.stringify(['property', meta.property]);
}

function linkIdentity(link: ReactPageLink): string {
  return JSON.stringify([link.rel, link.href]);
}

function cloneMeta(meta: ReactPageMeta): ReactPageMeta {
  return meta.name !== undefined
    ? Object.freeze({ content: meta.content, name: meta.name })
    : Object.freeze({ content: meta.content, property: meta.property });
}

function cloneLink(link: ReactPageLink): ReactPageLink {
  return Object.freeze({
    href: link.href,
    ...(link.media === undefined ? {} : { media: link.media }),
    rel: link.rel,
    ...(link.type === undefined ? {} : { type: link.type }),
  });
}

/**
 * Marks a React router class or `@Path(...)` method with one page metadata factory.
 *
 * @param factory Synchronous request-aware factory consumed by the application page renderer.
 * @returns A class-or-method decorator that records render-only metadata without changing HTTP matching.
 */
export function PageMetadata(factory: ReactPageMetadataFactory): ReactRenderPolicyDecorator {
  return createReactRenderPolicyDecorator('page-metadata', factory);
}

/**
 * Resolves ordered page metadata factories for one active request.
 *
 * @param policies Matched page policies supplied to the application renderer.
 * @param context Active request-scoped React render context.
 * @returns A frozen metadata snapshot with deterministic nearest-title and descriptor replacement semantics.
 */
export function resolveReactPageMetadata(
  policies: ReactRenderPolicies,
  context: ReactRenderContext,
): ReactPageMetadata {
  const metadataContext: ReactPageMetadataContext = Object.freeze({
    container: context.container,
    request: context.request,
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
  });
  const meta = new Map<string, ReactPageMeta>();
  const links = new Map<string, ReactPageLink>();
  let title: string | undefined;

  for (const factory of policies.pageMetadata ?? []) {
    const declaration = factory(metadataContext);
    if (declaration.title !== undefined) {
      title = declaration.title;
    }
    for (const descriptor of declaration.meta ?? []) {
      const cloned = cloneMeta(descriptor);
      replaceEntry(meta, metaIdentity(cloned), cloned);
    }
    for (const descriptor of declaration.links ?? []) {
      const cloned = cloneLink(descriptor);
      replaceEntry(links, linkIdentity(cloned), cloned);
    }
  }

  return Object.freeze({
    ...(links.size === 0 ? {} : { links: Object.freeze([...links.values()]) }),
    ...(meta.size === 0 ? {} : { meta: Object.freeze([...meta.values()]) }),
    ...(title === undefined ? {} : { title }),
  });
}

/**
 * Creates escaped ordinary React head elements from resolved page metadata.
 *
 * @param metadata Resolved metadata snapshot for one matched page request.
 * @returns Frozen title, meta, and link elements in deterministic composition order.
 */
export function createReactPageMetadataElements(
  metadata: ReactPageMetadata,
): readonly ReactElement[] {
  const elements: ReactElement[] = [];

  if (metadata.title !== undefined) {
    elements.push(createElement('title', { key: 'title' }, metadata.title));
  }
  for (const meta of metadata.meta ?? []) {
    elements.push(
      meta.name !== undefined
        ? createElement('meta', {
            content: meta.content,
            key: `meta:${metaIdentity(meta)}`,
            name: meta.name,
          })
        : createElement('meta', {
            content: meta.content,
            key: `meta:${metaIdentity(meta)}`,
            property: meta.property,
          }),
    );
  }
  for (const link of metadata.links ?? []) {
    elements.push(createElement('link', {
      href: link.href,
      key: `link:${linkIdentity(link)}`,
      ...(link.media === undefined ? {} : { media: link.media }),
      rel: link.rel,
      ...(link.type === undefined ? {} : { type: link.type }),
    }));
  }

  return Object.freeze(elements);
}
