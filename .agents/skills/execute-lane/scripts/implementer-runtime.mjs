import {
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const IMPLEMENTER_AGENT = 'fluo-issue-implementer';
const IMPLEMENTER_PROVIDER = 'openai-codex';
const IMPLEMENTER_MODEL = 'gpt-5.6-terra';
const IMPLEMENTER_THINKING = 'high';
const TASK_ID = /^st_[A-Za-z0-9]+$/u;

export const implementerRoute = Object.freeze({
  subagent_type: IMPLEMENTER_AGENT,
  expected_model: `${IMPLEMENTER_PROVIDER}/${IMPLEMENTER_MODEL}`,
  expected_thinking: IMPLEMENTER_THINKING,
});

const assertRegularFile = (path) => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TypeError(`${path} must be a real regular file.`);
  }
};

const assertDirectory = (path) => {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError(`${path} must be a real directory.`);
  }
};

const parseJson = (source, path) => {
  try {
    return JSON.parse(source);
  } catch {
    throw new TypeError(`${path} must contain valid JSON.`);
  }
};

const assertTaskRecord = (record) => {
  if (
    record.status !== 'completed' ||
    record.agent_type !== IMPLEMENTER_AGENT ||
    record.resolved_model?.source !== 'agent' ||
    record.resolved_model.provider !== IMPLEMENTER_PROVIDER ||
    record.resolved_model.model_id !== IMPLEMENTER_MODEL ||
    record.resolved_model.reasoning_effort !== IMPLEMENTER_THINKING
  ) {
    throw new TypeError(
      'implementer task metadata must resolve the configured Terra high agent.',
    );
  }
};

const readSessionEvents = (sessionRoot) => {
  assertDirectory(sessionRoot);
  const files = readdirSync(sessionRoot)
    .filter((name) => name.endsWith('.jsonl'))
    .sort();
  if (files.length === 0) {
    throw new TypeError('implementer task must persist a child session.');
  }
  return files.flatMap((name) => {
    const path = join(sessionRoot, name);
    assertRegularFile(path);
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => parseJson(line, path));
  });
};

const assertActualRuntime = (events) => {
  const modelChanges = events.filter((event) => event.type === 'model_change');
  const thinkingChanges = events.filter(
    (event) => event.type === 'thinking_level_change',
  );
  const assistantMessages = events.filter(
    (event) =>
      event.type === 'message' &&
      event.message?.role === 'assistant',
  );
  const modelMatches = modelChanges.length > 0 && modelChanges.every(
    (event) =>
      event.provider === IMPLEMENTER_PROVIDER &&
      event.modelId === IMPLEMENTER_MODEL,
  );
  const thinkingMatches =
    thinkingChanges.length > 0 &&
    thinkingChanges.every(
      (event) => event.thinkingLevel === IMPLEMENTER_THINKING,
    );
  const assistantMatches =
    assistantMessages.length > 0 &&
    assistantMessages.every(
      (event) =>
        event.message.provider === IMPLEMENTER_PROVIDER &&
        event.message.model === IMPLEMENTER_MODEL,
    );
  if (!modelMatches || !thinkingMatches || !assistantMatches) {
    throw new TypeError(
      'actual implementer session must use openai-codex/gpt-5.6-terra with high thinking.',
    );
  }
  return assistantMessages.length;
};

export const verifyImplementerRuntime = (runtimeRoot, taskId) => {
  if (!TASK_ID.test(taskId)) {
    throw new TypeError('implementer task id is malformed.');
  }
  const taskPath = join(runtimeRoot, 'tasks', `${taskId}.json`);
  assertRegularFile(taskPath);
  const taskRecord = parseJson(readFileSync(taskPath, 'utf8'), taskPath);
  if (taskRecord.task_id !== taskId) {
    throw new TypeError('implementer task record identity does not match.');
  }
  assertTaskRecord(taskRecord);
  const events = readSessionEvents(
    join(runtimeRoot, 'children', taskId, 'sessions', taskId),
  );
  return {
    task_id: taskId,
    provider: IMPLEMENTER_PROVIDER,
    model_id: IMPLEMENTER_MODEL,
    thinking_level: IMPLEMENTER_THINKING,
    assistant_turns: assertActualRuntime(events),
  };
};

const isCli =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCli) {
  const [runtimeRoot, taskId] = process.argv.slice(2);
  if (runtimeRoot === undefined || taskId === undefined) {
    throw new TypeError(
      'usage: implementer-runtime.mjs <runtime-root> <task-id>',
    );
  }
  process.stdout.write(
    `${JSON.stringify(verifyImplementerRuntime(runtimeRoot, taskId))}\n`,
  );
}
