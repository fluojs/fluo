import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const { implementerRoute, verifyImplementerRuntime } = (await import(
  resolve(
    repoRoot,
    '.agents/skills/execute-lane/scripts/implementer-runtime.mjs',
  )
)) as {
  implementerRoute: Readonly<{
    subagent_type: 'fluo-issue-implementer';
    expected_model: 'openai-codex/gpt-5.6-terra';
    expected_thinking: 'high';
  }>;
  verifyImplementerRuntime: (
    runtimeRoot: string,
    taskId: string,
  ) => Readonly<{
    task_id: string;
    provider: string;
    model_id: string;
    thinking_level: string;
    assistant_turns: number;
  }>;
};

const sessionEvents = (
  provider: string,
  modelId: string,
  thinkingLevel: string,
): string =>
  [
    {
      type: 'model_change',
      provider,
      modelId,
    },
    {
      type: 'thinking_level_change',
      thinkingLevel,
    },
    {
      type: 'message',
      message: {
        role: 'assistant',
        provider,
        model: modelId,
        content: [{ type: 'text', text: 'done' }],
      },
    },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');

const writeTaskEvidence = (
  runtimeRoot: string,
  taskId: string,
  session: string,
): void => {
  const taskRoot = join(runtimeRoot, 'tasks');
  const sessionRoot = join(
    runtimeRoot,
    'children',
    taskId,
    'sessions',
    taskId,
  );
  mkdirSync(taskRoot, { recursive: true });
  mkdirSync(sessionRoot, { recursive: true });
  writeFileSync(
    join(taskRoot, `${taskId}.json`),
    JSON.stringify({
      task_id: taskId,
      status: 'completed',
      agent_type: 'fluo-issue-implementer',
      resolved_model: {
        source: 'agent',
        provider: 'openai-codex',
        model_id: 'gpt-5.6-terra',
        reasoning_effort: 'high',
      },
    }),
  );
  writeFileSync(join(sessionRoot, 'session.jsonl'), `${session}\n`);
};

describe('execute-lane implementer runtime routing', () => {
  it('ships a project agent that resolves Terra with high reasoning', () => {
    const config = JSON.parse(
      readFileSync(resolve(repoRoot, '.omo/omo.jsonc'), 'utf8'),
    );

    expect(config.agents['fluo-issue-implementer']).toMatchObject({
      model: 'openai-codex/gpt-5.6-terra',
      reasoning: 'high',
    });
    expect(implementerRoute).toEqual({
      subagent_type: 'fluo-issue-implementer',
      expected_model: 'openai-codex/gpt-5.6-terra',
      expected_thinking: 'high',
    });
  });

  it('accepts only child session evidence from Terra high', () => {
    const root = mkdtempSync(join(tmpdir(), 'fluo-implementer-runtime-'));
    try {
      writeTaskEvidence(
        root,
        'st_valid',
        sessionEvents('openai-codex', 'gpt-5.6-terra', 'high'),
      );

      expect(verifyImplementerRuntime(root, 'st_valid')).toEqual({
        task_id: 'st_valid',
        provider: 'openai-codex',
        model_id: 'gpt-5.6-terra',
        thinking_level: 'high',
        assistant_turns: 1,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects request metadata when the child actually ran a fallback model', () => {
    const root = mkdtempSync(join(tmpdir(), 'fluo-implementer-fallback-'));
    try {
      writeTaskEvidence(
        root,
        'st_fallback',
        sessionEvents('alibaba-token-plan', 'qwen3.7-max', 'medium'),
      );

      expect(() =>
        verifyImplementerRuntime(root, 'st_fallback'),
      ).toThrow(/actual implementer session must use openai-codex\/gpt-5\.6-terra with high thinking/u);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
