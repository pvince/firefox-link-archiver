/**
 * Creates a source code ZIP for AMO submission.
 * Includes all files a reviewer needs to reproduce the XPI:
 *   - Source code (src/, scripts/, build.cjs)
 *   - manifest.json, package.json, package-lock.json, tsconfig.json
 *   - README.md (contains build instructions)
 *
 * Run: npm run package-source
 * Output: archivebox-autosync-source.zip
 */

import { ZipArchive } from 'archiver';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'archivebox-autosync-source.zip');
const MAX_SOURCE_ZIP_BYTES = 200 * 1024 * 1024;

const INCLUDE_FILES = [
  'manifest.json',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'build.cjs',
  'jest.config.json',
  'README.md',
  'AGENTS.md',
];

const INCLUDE_DIRS = [
  'src',
  'scripts',
  'plans',
];

if (fs.existsSync(OUTPUT)) fs.unlinkSync(OUTPUT);

const output = fs.createWriteStream(OUTPUT);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on('close', () => {
  const bytes = archive.pointer();
  const kb = (bytes / 1024).toFixed(2);
  const mb = (bytes / (1024 * 1024)).toFixed(2);

  if (bytes > MAX_SOURCE_ZIP_BYTES) {
    console.error(`❌ Source ZIP exceeds AMO 200 MB limit: ${mb} MB`);
    process.exit(1);
  }

  console.log(`✅ Source ZIP created: ${OUTPUT}`);
  console.log(`   Size: ${kb} KB`);
  console.log(`   AMO limit check: ${mb} MB / 200.00 MB`);
  console.log('');
  console.log('📤 Upload this file to AMO as the source code submission.');
});

archive.on('error', (err) => { throw err; });
archive.pipe(output);

for (const file of INCLUDE_FILES) {
  const full = path.join(ROOT, file);
  if (fs.existsSync(full)) {
    archive.file(full, { name: file });
  } else {
    console.warn(`⚠️  Skipping missing file: ${file}`);
  }
}

for (const dir of INCLUDE_DIRS) {
  const full = path.join(ROOT, dir);
  if (fs.existsSync(full)) {
    archive.directory(full, dir);
  } else {
    console.warn(`⚠️  Skipping missing directory: ${dir}`);
  }
}

archive.finalize();
