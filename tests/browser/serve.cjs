// Serve a folder with python3's static server on a free port.
const { spawn } = require('node:child_process');

function serve(directory) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-u', '-m', 'http.server', '0', '--bind', '127.0.0.1'], { cwd: directory, stdio: ['ignore', 'pipe', 'ignore'] });   // stderr is ignored: python logs every request there, and an unread pipe fills up (~64 KB) and freezes the server mid-run
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', (data) => {
      const match = /port (\d+)/.exec(String(data));
      if (!match) return;
      clearTimeout(timer);
      resolve({ url: `http://127.0.0.1:${match[1]}/`, stop: () => child.kill() });
    });
    child.on('error', reject);
  });
}

module.exports = { serve };
