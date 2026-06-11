import fs from 'node:fs';

const upstream = '/home/vscode/projects/material-ui/packages/mui-material/src/index.js';
const manifestPath = new URL('../data/material-components.json', import.meta.url);

function readUpstreamComponents() {
  const source = fs.readFileSync(upstream, 'utf8');
  const components = [];
  for (const line of source.split('\n')) {
    const match = line.match(/^export \{ default as ([A-Z][A-Za-z0-9_]*|Unstable_[A-Za-z0-9_]+) \}/);
    if (!match) continue;
    const name = match[1];
    if (name.startsWith('use')) continue;
    components.push(name);
  }
  return components;
}

const upstreamComponents = readUpstreamComponents();
const manifestComponents = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (process.argv.includes('--check')) {
  const upstreamText = upstreamComponents.join('\n');
  const manifestText = manifestComponents.join('\n');
  if (upstreamText !== manifestText) {
    const missing = upstreamComponents.filter((name) => !manifestComponents.includes(name));
    const extra = manifestComponents.filter((name) => !upstreamComponents.includes(name));
    console.error('component manifest mismatch');
    if (missing.length) console.error(`missing: ${missing.join(', ')}`);
    if (extra.length) console.error(`extra: ${extra.join(', ')}`);
    process.exit(1);
  }
  console.log(`component manifest OK (${manifestComponents.length})`);
} else {
  console.log(upstreamComponents.join('\n'));
}
