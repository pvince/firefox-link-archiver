#!/usr/bin/env node

/**
 * Package script: builds extension and creates XPI file
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import archiver from 'archiver';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.join(__dirname, '..', 'dist');
const MANIFEST = path.join(__dirname, '..', 'manifest.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'archivebox-autosync.xpi');

async function packageExtension() {
  try {
    console.log('📦 Building extension...');
    execSync('npm run build', { stdio: 'inherit' });

    if (!fs.existsSync(DIST_DIR)) {
      throw new Error('Build failed: dist directory not found');
    }

    console.log('📝 Creating XPI package...');

    const output = fs.createWriteStream(OUTPUT_FILE);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', async () => {
        const sizeKB = (archive.pointer() / 1024).toFixed(2);
        console.log(`✅ XPI created: ${OUTPUT_FILE}`);
        console.log(`   Size: ${sizeKB} KB`);
        
        // Auto-validate XPI
        console.log('\n');
        try {
          execSync(`node "${path.join(__dirname, 'validate.js')}"`, { 
            stdio: 'inherit' 
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);

      // Add manifest at root
      archive.file(MANIFEST, { name: 'manifest.json' });

      // Add all dist files (JavaScript bundles)
      archive.directory(DIST_DIR, 'dist');

      // Add HTML files to src directory in archive
      const optionsHtml = path.join(__dirname, '..', 'src', 'options', 'index.html');
      const popupHtml = path.join(__dirname, '..', 'src', 'popup', 'index.html');
      
      if (fs.existsSync(optionsHtml)) {
        archive.file(optionsHtml, { name: 'src/options/index.html' });
      }
      
      if (fs.existsSync(popupHtml)) {
        archive.file(popupHtml, { name: 'src/popup/index.html' });
      }

      // Add icons if they exist
      const assetsDir = path.join(__dirname, '..', 'src', 'assets');
      if (fs.existsSync(assetsDir)) {
        const files = fs.readdirSync(assetsDir);
        files.forEach((file) => {
          const filePath = path.join(assetsDir, file);
          archive.file(filePath, { name: `src/assets/${file}` });
        });
      }

      archive.finalize();
    });
  } catch (err) {
    console.error('❌ Packaging failed:', err.message);
    process.exit(1);
  }
}

packageExtension();
