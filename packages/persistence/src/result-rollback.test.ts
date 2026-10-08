import { describe, expect, it, vi } from 'vitest';
import { TransactionRollbackOnlyError, TransactionRollbackUnconfirmedError } from './index.js';
import { evaluateResult, ResultBoundary, type RollbackOwner } from './internal.js';

describe('shared Result rollback policy', () => {
  it('preserves the root value after its exact signal and confirmed rollback', async () => {
    const nested = { ok: false };
    const root = { ok: false };
    const confirmRollback = vi.fn(() => true as const);
    const owner: RollbackOwner = { observation: { confirmRollback } };
    evaluateResult(owner, nested, () => true);
    const boundary = new ResultBoundary(owner, () => true);
    boundary.evaluate(root);

    const result = await boundary.recover(owner.rollbackOnly);

    expect(result).toBe(root);
    expect(owner.rollbackOnly?.result).toBe(nested);
    expect(confirmRollback).toHaveBeenCalledTimes(1);
  });

  it('keeps the first nested failure sticky when the root accepts its own result', async () => {
    const first = {};
    const owner: RollbackOwner = { observation: { confirmRollback: () => true } };
    evaluateResult(owner, first, () => true);
    evaluateResult(owner, {}, () => true);
    const boundary = new ResultBoundary(owner);
    boundary.evaluate({});

    await expect(boundary.recover(owner.rollbackOnly)).rejects.toBe(owner.rollbackOnly);
    expect(owner.rollbackOnly?.result).toBe(first);
  });

  it('does not infer rollback from failure-shaped values without a predicate', () => {
    const value = { ok: false };
    const owner: RollbackOwner = {};
    const boundary = new ResultBoundary(owner);

    expect(boundary.evaluate(value)).toBe(value);
    expect(() => boundary.assertCommittable()).not.toThrow();
    expect(owner.rollbackOnly).toBeUndefined();
  });

  it('rejects a different signal without consulting native confirmation', async () => {
    const confirmRollback = vi.fn(() => true as const);
    const owner: RollbackOwner = { observation: { confirmRollback } };
    const boundary = new ResultBoundary(owner, () => true);
    boundary.evaluate({});
    const other = new TransactionRollbackOnlyError({});

    await expect(boundary.recover(other)).rejects.toBe(other);
    expect(confirmRollback).not.toHaveBeenCalled();
  });

  it('rejects missing positive native observation instead of returning a Result', async () => {
    const owner: RollbackOwner = {};
    const boundary = new ResultBoundary(owner, () => true);
    boundary.evaluate({});

    await expect(boundary.recover(owner.rollbackOnly)).rejects.toBeInstanceOf(TransactionRollbackUnconfirmedError);
  });

  it('propagates an observed native rollback failure unchanged', async () => {
    const failure = new Error('native rollback failed');
    const owner: RollbackOwner = { observation: { confirmRollback: () => { throw failure; } } };
    const boundary = new ResultBoundary(owner, () => true);
    boundary.evaluate({});

    await expect(boundary.recover(owner.rollbackOnly)).rejects.toBe(failure);
  });

  it('isolates discarded native attempt state from a fresh owner', () => {
    const discarded: RollbackOwner = {};
    evaluateResult(discarded, {}, () => true);
    const fresh: RollbackOwner = {};
    const boundary = new ResultBoundary(fresh);

    boundary.evaluate({});

    expect(() => boundary.assertCommittable()).not.toThrow();
    expect(fresh.rollbackOnly).toBeUndefined();
    expect(discarded.rollbackOnly).toBeInstanceOf(TransactionRollbackOnlyError);
  });
});
