const { spawn } = require('child_process');
const path = require('path');

const entries = ['auth', 'drive', 'preview'];
const tailwindBin = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss'
);

const children = entries.map((name) => {
  const child = spawn(
    tailwindBin,
    ['-i', `src/css/${name}.css`, '-o', `public/css/${name}.css`, '--watch'],
    { stdio: 'inherit', shell: process.platform === 'win32' }
  );
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    if (code && code !== 0) process.exit(code);
  });
  return child;
});

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
