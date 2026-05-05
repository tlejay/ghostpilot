#!/usr/bin/env node
// Render assets/icon.svg into a Mac .icns + a 1024 PNG.
// Requires: sharp (devDep) + iconutil (built into macOS).

import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SVG = join(ROOT, 'assets/icon.svg');
const ICONSET = join(ROOT, 'assets/icon.iconset');
const ICNS = join(ROOT, 'assets/icon.icns');
const PNG_1024 = join(ROOT, 'assets/icon.png');

const SIZES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

const { default: sharp } = await import('sharp');

await fs.rm(ICONSET, { recursive: true, force: true });
await fs.mkdir(ICONSET, { recursive: true });

const svg = await fs.readFile(SVG);

await Promise.all(
  SIZES.map(([name, size]) =>
    sharp(svg, { density: Math.max(72, Math.ceil((size / 1024) * 600)) })
      .resize(size, size)
      .png()
      .toFile(join(ICONSET, name)),
  ),
);

if (process.platform !== 'darwin') {
  console.log(`✓ wrote ${SIZES.length} PNGs to ${ICONSET}`);
  console.log('   (skipping iconutil — only available on macOS)');
} else {
  execFileSync('iconutil', ['-c', 'icns', '-o', ICNS, ICONSET], { stdio: 'inherit' });
  console.log(`✓ wrote ${ICNS}`);
}

// Also keep a flat 1024 PNG for dev-mode dock icon + fallback
await sharp(svg, { density: 600 }).resize(1024, 1024).png().toFile(PNG_1024);
console.log(`✓ wrote ${PNG_1024}`);
