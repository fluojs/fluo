import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fixtureDir } from './verify-lane-ledger.test-support';

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixtureDir}/${name}`, 'utf8'));
}

function structuralDiff(left: unknown, right: unknown, path = ''): string[] {
  if (Object.is(left, right)) {
    return [];
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const indexes = new Set([...left.keys(), ...right.keys()]);
    return [...indexes].flatMap((index) => structuralDiff(left[index], right[index], `${path}[${String(index)}]`));
  }
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    const leftRecord = Object.fromEntries(Object.entries(left));
    const rightRecord = Object.fromEntries(Object.entries(right));
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
    return [...keys].flatMap((key) => structuralDiff(leftRecord[key], rightRecord[key], path ? `${path}.${key}` : key));
  }
  return [path];
}

describe('lane ledger invalid fixture isolation', () => {
  const validReady = readFixture('valid-ready.json');

  it.each([
    ['invalid-merge-method.json', ['pr_merge_method']],
    ['invalid-missing-merge-method.json', ['pr_merge_method']],
    ['invalid-pr-merge-false.json', ['authority_scope.pr_merge']],
  ])('keeps %s limited to its named violation', (fixture, expectedDiff) => {
    expect(structuralDiff(validReady, readFixture(fixture))).toEqual(expectedDiff);
  });
});
