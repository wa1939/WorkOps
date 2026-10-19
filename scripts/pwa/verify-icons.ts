import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// These are compliant placeholders because no approved app-logo artwork exists in
// public/. Replace all four PNGs with final brand artwork before production.
const expected = [
  { name: 'app-192.png', width: 192, height: 192 },
  { name: 'app-512.png', width: 512, height: 512 },
  { name: 'app-maskable-512.png', width: 512, height: 512 },
  { name: 'apple-touch-icon.png', width: 192, height: 192 },
] as const;

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const iconsDir = join(process.cwd(), 'public', 'icons');
let failed = false;

for (const icon of expected) {
  const path = join(iconsDir, icon.name);
  try {
    const bytes = readFileSync(path);
    const isPng = bytes.subarray(0, pngSignature.length).equals(pngSignature);
    if (!isPng || bytes.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error('invalid PNG signature or IHDR chunk');
    }

    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== icon.width || height !== icon.height) {
      throw new Error(`expected ${icon.width}x${icon.height}, got ${width}x${height}`);
    }

    console.log(`✓ ${icon.name}: image/png, ${width}x${height}, ${bytes.length} bytes`);
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${icon.name}: ${message}`);
  }
}

if (failed) {
  process.exitCode = 1;
}
