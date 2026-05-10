#!/usr/bin/env node

/**
 * Validate XPI structure
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const XPI_FILE = path.join(__dirname, '..', 'archivebox-autosync.xpi');

function listZipContents(zipPath) {
  // Use Node built-in approach: read the ZIP central directory
  // For simplicity, use a minimal unzip approach by reading ZIP structure
  const buffer = fs.readFileSync(zipPath);
  const files = [];

  // Find central directory end marker (0x06054b50 in little-endian)
  let cdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b && 
        buffer[i + 2] === 0x05 && buffer[i + 3] === 0x06) {
      cdOffset = i;
      break;
    }
  }

  if (cdOffset === -1) {
    throw new Error('Invalid ZIP file: central directory not found');
  }

  // Parse central directory
  let pos = buffer.readUInt32LE(cdOffset + 16);
  const cdSize = buffer.readUInt32LE(cdOffset + 12);
  const cdEnd = pos + cdSize;

  while (pos < cdEnd) {
    if (buffer[pos] !== 0x50 || buffer[pos + 1] !== 0x4b ||
        buffer[pos + 2] !== 0x01 || buffer[pos + 3] !== 0x02) {
      break;
    }

    const fileNameLen = buffer.readUInt16LE(pos + 28);
    const fileName = buffer.toString('utf8', pos + 46, pos + 46 + fileNameLen);
    files.push(fileName);

    pos += 46 + fileNameLen + buffer.readUInt16LE(pos + 30) + buffer.readUInt16LE(pos + 32);
  }

  return files.sort();
}

async function validateXpi() {
  try {
    if (!fs.existsSync(XPI_FILE)) {
      console.error('❌ XPI file not found:', XPI_FILE);
      process.exit(1);
    }

    console.log('🔍 Validating XPI structure...\n');

    let files;
    try {
      files = listZipContents(XPI_FILE);
    } catch (err) {
      console.error('❌ Failed to read XPI:', err.message);
      process.exit(1);
    }

    console.log('📦 XPI Contents:');
    files.forEach((f) => console.log('  ' + f));

    // Validate manifest.json
    if (!files.includes('manifest.json')) {
      console.error('\n❌ CRITICAL: manifest.json missing from XPI');
      process.exit(1);
    }

    let manifest;
    try {
      const manifestPath = path.join(__dirname, '..', 'manifest.json');
      const manifestContent = fs.readFileSync(manifestPath, 'utf8');
      manifest = JSON.parse(manifestContent);
      console.log('\n✅ manifest.json is valid JSON');
    } catch (err) {
      console.error('\n❌ CRITICAL: manifest.json is invalid JSON:', err.message);
      process.exit(1);
    }

    // Check manifest version
    if (manifest.manifest_version !== 3) {
      console.error(
        `\n❌ CRITICAL: Wrong manifest_version (${manifest.manifest_version}). Must be 3.`
      );
      process.exit(1);
    }
    console.log('✅ Manifest version is 3');

    // Validate paths referenced in manifest
    const pathsToCheck = [];
    
    if (manifest.action?.default_popup) {
      pathsToCheck.push({ path: manifest.action.default_popup, label: 'action.default_popup' });
    }
    if (manifest.options_ui?.page) {
      pathsToCheck.push({ path: manifest.options_ui.page, label: 'options_ui.page' });
    }
    if (manifest.background?.service_worker) {
      console.error('❌ INVALID: background.service_worker is not supported in Firefox. Use background.scripts instead.');
      process.exit(1);
    }
    if (manifest.background?.scripts) {
      manifest.background.scripts.forEach((script, idx) => {
        pathsToCheck.push({ path: script, label: `background.scripts[${idx}]` });
      });
    }

    const iconPaths = Object.entries(manifest.icons || {});
    iconPaths.forEach(([size, iconPath]) => {
      pathsToCheck.push({ path: iconPath, label: `icons[${size}]` });
    });

    let hasMissingPaths = false;
    pathsToCheck.forEach(({ path: refPath, label }) => {
      if (!refPath) return;

      if (files.includes(refPath)) {
        console.log(`✅ ${label}: ${refPath}`);
      } else {
        console.error(`❌ MISSING: ${label}: ${refPath}`);
        hasMissingPaths = true;
      }
    });

    if (hasMissingPaths) {
      console.error('\n❌ XPI has missing required files');
      process.exit(1);
    }

    console.log('\n✅ All required files present');

    // Check dist files exist
    const distFiles = files.filter((f) => f.startsWith('dist/') && f.endsWith('.js'));
    if (distFiles.length === 0) {
      console.error('❌ No JavaScript files found in dist/');
      process.exit(1);
    }

    console.log(`✅ Found ${distFiles.length} JavaScript bundle(s)`);

    console.log('\n🎉 XPI structure is VALID and ready to install!');
    console.log('\n📥 Install in Firefox:');
    console.log('   1. Open about:addons');
    console.log('   2. Click ⚙️ → "Install Add-on from File"');
    console.log('   3. Select archivebox-autosync.xpi');
  } catch (err) {
    console.error('❌ Validation failed:', err.message);
    process.exit(1);
  }
}

validateXpi();
