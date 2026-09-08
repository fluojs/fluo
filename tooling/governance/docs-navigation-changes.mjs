const markerPrefix = 'fluo:docs-navigation';

export function isNavigationDocument(path) {
  return /^book\/(?:beginner|intermediate|advanced)\/ch\d{2}-[^/]+(?:\.ko)?\.md$/u.test(path)
    || /^docs\/CONTEXT(?:\.ko)?\.md$/u.test(path);
}

function isAdditiveNavigation(snapshot) {
  if (typeof snapshot?.base !== 'string' || typeof snapshot.head !== 'string') {
    return false;
  }

  // Only a first, newly inserted block is eligible. Stripping old marked regions
  // as well would hide edits, removals, or moves of already published content.
  if (snapshot.base.includes(markerPrefix) || snapshot.head.split(markerPrefix).length !== 3) {
    return false;
  }

  const block = /^<!-- fluo:docs-navigation:start -->\n([\s\S]*?)^<!-- fluo:docs-navigation:end -->\n/mu.exec(snapshot.head);
  if (!block) {
    return false;
  }

  const before = snapshot.head.slice(0, block.index);
  const body = block[1];
  // Status/navigation belongs in a standalone introductory paragraph or
  // blockquote, never inside a code fence, HTML block, or existing paragraph.
  if (
    (before !== '' && !before.endsWith('\n\n'))
    || /```|~~~/u.test(before)
    || before.replace(/<!--[\s\S]*?-->/gu, '').includes('<')
    || !body.endsWith('\n\n')
    || !/\[[^\]\n]+\]\([^\n)]+\)/u.test(body)
    || body.includes('<')
    || body.split('\n').some((line) =>
      /^(?:[ \t]|#{1,6}(?:\s|$)|`{3,}|~{3,}|\[[^\]]+\]:|[-=]+\s*$)/u.test(
        line.replace(/^(?:> ?)+/u, ''),
      ))
  ) {
    return false;
  }

  return before + snapshot.head.slice(block.index + block[0].length) === snapshot.base;
}

export function behavioralChangedFiles(changedFiles, documentSnapshots) {
  return changedFiles.filter((path) => {
    if (!isNavigationDocument(path) || !isAdditiveNavigation(documentSnapshots?.[path])) {
      return true;
    }

    const counterpart = path.endsWith('.ko.md')
      ? path.replace(/\.ko\.md$/u, '.md')
      : path.replace(/\.md$/u, '.ko.md');
    if (!changedFiles.includes(counterpart)) {
      throw new Error(`Navigation-only documentation updates must preserve EN/KO companions: ${path} and ${counterpart}.`);
    }
    return false;
  });
}
