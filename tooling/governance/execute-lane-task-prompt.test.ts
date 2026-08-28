import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const {
  IMPLEMENTER_FINAL_SENTINEL,
  IMPLEMENTER_SENTINEL,
  implementerTaskPrompt,
} = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/implementer-runtime.mjs',
  )
);
const { parseTerminalDispatchShape } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/dispatch-authority.mjs',
  )
);
const { reviewerTaskPrompt } = await import(
  resolve(
    process.cwd(),
    '.agents/skills/execute-lane/scripts/reviewer-runtime.mjs',
  )
);

const authority = {
  repository_root: process.cwd(),
  lane_id: 'lane-4101-runtime',
  issue_number: 4101,
  worktree: '.worktrees/issue-4101-runtime',
  current_head: '1'.repeat(40),
  parent_session_id: 'ses-issue-4101-supervisor',
  generation: 1,
  blocker_ledger: [],
  unresolved_blockers: [],
  blocker_ledger_sha256: '2'.repeat(64),
  preflight_sha256: '3'.repeat(64),
};

describe('execute-lane terminal task prompts', () => {
  it('places implementer authority in exactly one final dispatch block', () => {
    const prompt = implementerTaskPrompt({
      instructions:
        'Implement only the accepted issue contract and return one final wrapper.',
      ...authority,
    });
    const dispatch = parseTerminalDispatchShape(
      prompt,
      IMPLEMENTER_SENTINEL,
    );

    expect(prompt).toContain('Implement only the accepted issue contract');
    expect(prompt.endsWith('</fluo-terminal-dispatch-v1>')).toBe(true);
    expect(prompt.match(/<fluo-terminal-dispatch-v1>/gu)).toHaveLength(1);
    expect(prompt.match(new RegExp(IMPLEMENTER_SENTINEL, 'gu'))).toHaveLength(1);
    expect(prompt.match(/"preflight_sha256"/gu)).toHaveLength(1);
    expect(prompt).toContain(
      `<${IMPLEMENTER_FINAL_SENTINEL}>{"sentinel":"${IMPLEMENTER_FINAL_SENTINEL}",...}</${IMPLEMENTER_FINAL_SENTINEL}>`,
    );
    for (const field of [
      'lane_id',
      'issue_number',
      'worktree',
      'parent_session_id',
      'current_head',
      'new_head',
      'generation',
      'scope',
      'result',
      'verification',
      'addressed_blockers',
      'blocker_ledger_sha256',
      'preflight_sha256',
    ]) {
      expect(prompt).toContain(field);
    }
    expect(dispatch.tool_policy).toEqual({
      allowed: ['read', 'bash', 'apply_patch'],
      forbidden: ['eval', 'todo', 'task', 'dag', 'team'],
    });
  });

  it('rejects narrative copies of dispatch authority', () => {
    const canonicalPreflightPath = resolve(
      process.cwd(),
      '.omo/lane-runs/lane-4101-runtime/issues/4101/review-preflight.json',
    );

    expect(() =>
      implementerTaskPrompt({
        instructions: `Use ${canonicalPreflightPath} as the accepted preflight.`,
        ...authority,
      }),
    ).toThrow(/duplicate, decoy, or conflicting dispatch authority/u);
    expect(() =>
      implementerTaskPrompt({
        instructions: `Dispatch sentinel: ${IMPLEMENTER_SENTINEL}`,
        ...authority,
      }),
    ).toThrow(/duplicate, decoy, or conflicting dispatch authority/u);
  });

  it('applies the same single-authority rule to reviewer prompts', () => {
    const prompt = reviewerTaskPrompt({
      instructions:
        'Review the immutable head and return one canonical reviewer wrapper.',
      repository_root: process.cwd(),
      lane_id: 'lane-4101-runtime',
      issue_number: 4101,
      worktree: '.worktrees/issue-4101-runtime',
      head_sha: '1'.repeat(40),
      preflight_sha256: '3'.repeat(64),
      review_axis: 'contract',
    });

    expect(prompt.endsWith('</fluo-terminal-dispatch-v1>')).toBe(true);
    expect(prompt.match(/<fluo-terminal-dispatch-v1>/gu)).toHaveLength(1);
    expect(prompt.match(/"preflight_sha256"/gu)).toHaveLength(1);
  });

  it('binds parent-owned verification receipt authority', () => {
    const prompt = reviewerTaskPrompt({
      instructions:
        'Read the parent-owned canonical receipt and return one reviewer wrapper.',
      repository_root: process.cwd(),
      lane_id: 'lane-4101-runtime',
      issue_number: 4101,
      worktree: '.worktrees/issue-4101-runtime',
      head_sha: '1'.repeat(40),
      preflight_sha256: '3'.repeat(64),
      review_axis: 'verification',
      canonical_verification_receipt_id: 'st_parent_verify_4101',
    });

    expect(prompt).toContain(
      '"canonical_verification_receipt_id":"st_parent_verify_4101"',
    );
    expect(prompt).toContain('"local_ci_role":"read-only"');
    expect(prompt).toContain('"artifact_writes":false');
  });
});
