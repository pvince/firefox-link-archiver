const esbuild = require('esbuild');
const path = require('path');

const entryPoints = [
  'src/background/index.ts',
  'src/popup/index.ts',
  'src/options/index.ts',
];

esbuild.build({
  entryPoints,
  outdir: 'dist',
  bundle: true,
  platform: 'browser',
  target: ['firefox109'],
  format: 'iife',
  sourcemap: false,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
}).then(() => {
  console.log('✅ Build successful');
}).catch((err) => {
  console.error('❌ Build failed:', err.message);
  process.exit(1);
});
