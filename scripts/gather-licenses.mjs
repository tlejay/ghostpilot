#!/usr/bin/env node
// Use `pnpm licenses list --prod --json` to enumerate every production package
// (including transitives) that gets bundled into the app, then read each
// LICENSE file and write a single notices.json shipped with the app.

import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'assets/notices.json');

const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

const grouped = JSON.parse(raw);

const LICENSE_FILES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENSE-MIT',
  'License',
  'license',
  'license.md',
  'COPYING',
  'COPYING.txt',
];

async function readLicenseFile(pkgPath) {
  for (const name of LICENSE_FILES) {
    try {
      return await fs.readFile(join(pkgPath, name), 'utf8');
    } catch {
      /* try next */
    }
  }
  return '';
}

const entries = [];
for (const [licenseId, packages] of Object.entries(grouped)) {
  for (const pkg of packages) {
    const path = pkg.paths?.[0];
    if (!path) continue;
    if (pkg.name === 'ghostpilot') continue;
    const licenseText = await readLicenseFile(path);
    entries.push({
      name: pkg.name,
      version: pkg.versions?.[0] ?? '',
      license: licenseId,
      author: pkg.author ?? '',
      homepage: pkg.homepage ?? '',
      description: pkg.description ?? '',
      licenseText,
    });
  }
}

entries.sort((a, b) => a.name.localeCompare(b.name));

await fs.mkdir(dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(entries, null, 2));

const counts = entries.reduce((acc, e) => {
  acc[e.license] = (acc[e.license] ?? 0) + 1;
  return acc;
}, {});
console.log(`✓ wrote ${entries.length} packages → ${OUT}`);
for (const [license, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${license}: ${count}`);
}
