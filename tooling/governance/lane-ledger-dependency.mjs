import { assert, isPositiveInteger } from './lane-ledger-contract.mjs';

function visitDependency(issue, context) {
  if (context.visited.has(issue)) {
    return;
  }
  assert(!context.visiting.has(issue), context.path, 'dependency_graph must not contain cycles');
  context.visiting.add(issue);
  for (const prerequisite of context.graph.get(issue) ?? []) {
    if (context.graph.has(prerequisite)) {
      visitDependency(prerequisite, context);
    }
  }
  context.visiting.delete(issue);
  context.visited.add(issue);
}

export function validateDependencyGraph(path, dependencyGraph, confirmedIssues) {
  const graph = new Map();
  for (const [issueKey, prerequisites] of Object.entries(dependencyGraph)) {
    const issue = Number(issueKey);
    assert(
      /^[1-9]\d*$/u.test(issueKey) && isPositiveInteger(issue) && confirmedIssues.has(issue),
      path,
      'dependency_graph keys must be confirmed positive integer issue numbers',
    );
    assert(Array.isArray(prerequisites), path, 'dependency_graph values must be arrays');
    assert(
      prerequisites.every(isPositiveInteger),
      path,
      'dependency_graph dependencies must be positive safe integer issue numbers',
    );
    const uniquePrerequisites = new Set(prerequisites);
    assert(uniquePrerequisites.size === prerequisites.length, path, 'dependency_graph dependencies must be unique');
    assert(!uniquePrerequisites.has(issue), path, 'dependency_graph must not contain self dependencies');
    graph.set(issue, prerequisites);
  }

  const context = { graph, path, visited: new Set(), visiting: new Set() };
  for (const issue of graph.keys()) {
    visitDependency(issue, context);
  }
}
