import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const publicFiles = new Set(['index.html', 'style.css', 'app.js', 'game.js', 'scene.js', 'animation.js', 'sound.js', 'landscape.js',
  'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js']);

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = resolve(root, name);
  if (!file.startsWith(root + sep) || !publicFiles.has(name)) {
    response.writeHead(404);
    response.end('Nicht gefunden');
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-cache' });
    response.end(body);
  } catch (error) {
    console.error('Datei konnte nicht geladen werden:', error);
    response.writeHead(500);
    response.end('Datei konnte nicht geladen werden');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Spiel bereit: http://localhost:${port}`);
});
server.on('error', error => {
  console.error('Server konnte nicht gestartet werden:', error.message);
  process.exitCode = 1;
});
