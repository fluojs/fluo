const fs = require('node:fs');
const path = require('node:path');
const root = process.env.SEARCH_STUB_ROOT;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(args) + '\n');
const config = JSON.parse(fs.readFileSync(path.join(root, 'gh.json'), 'utf8'));
if (args[0] === 'label') {
  console.log(JSON.stringify(config.labels.map(name => ({name}))));
} else if (args[0] === 'api') {
  if (config.lookup_failure) process.exit(1);
  const file = path.join(root, 'remote.json');
  const remote = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const issues = remote.map(issue => ({...issue, html_url: issue.url}));
  const endpoint = args.find(arg => arg.startsWith('repos/'));
  const url = new URL(endpoint, 'https://api.github.com/');
  const size = Number(url.searchParams.get('per_page'));
  const page = Number(url.searchParams.get('page') ?? 1);
  if (config.failed_page === page) process.exit(1);
  if (config.truncated_page === page) { console.log('HTTP/2.0 200 OK\n\n['); process.exit(0); }
  if (args.includes('--slurp')) {
    const pages = [];
    for (let offset = 0; offset < issues.length; offset += size) pages.push(issues.slice(offset, offset + size));
    console.log(JSON.stringify(pages));
  } else {
    const next = page * size < issues.length
      ? `Link: <https://api.github.com/${url.pathname.slice(1)}?state=all&per_page=${size}&page=${page + 1}>; rel="next"\n`
      : '';
    console.log(`HTTP/2.0 200 OK\n${next}\n${JSON.stringify(issues.slice((page - 1) * size, page * size))}`);
  }
} else if (args[1] === 'list') {
  if (config.lookup_failure) process.exit(1);
  if (config.search_stale) { console.log('[]'); process.exit(0); }
  const file = path.join(root, 'remote.json');
  console.log(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '[]');
} else if (args[1] === 'create') {
  const body = args[args.indexOf('--body') + 1];
  fs.writeFileSync(path.join(root, 'remote.json'), JSON.stringify([
    {number: 8001, url: 'https://github.com/fluojs/fluo/issues/8001', body}
  ]));
  if (config.interrupt === 'kill') {
    process.kill(process.ppid, 'SIGKILL');
    process.exit(1);
  }
  if (config.interrupt === 'malformed') { console.log('invalid-receipt'); process.exit(0); }
  if (config.interrupt) process.exit(1);
  console.log('https://github.com/fluojs/fluo/issues/8001');
} else process.exit(2);
