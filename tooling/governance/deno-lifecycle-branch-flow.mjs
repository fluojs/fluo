export function cloneLifecycleScopes(scopes) {
  return scopes.map((scope) => new Map(scope));
}

export function mergeLifecycleBranches(targetScopes, branchScopes, mergeState) {
  for (let index = 0; index < targetScopes.length; index += 1) {
    const target = targetScopes[index];
    const keys = new Set(branchScopes.flatMap((scopes) => [...scopes[index].keys()]));
    target.clear();
    for (const key of keys) {
      const states = branchScopes.map((scopes) => scopes[index].get(key));
      target.set(key, states.reduce(mergeState));
    }
  }
}
