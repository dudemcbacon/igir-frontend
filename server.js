// Zero-dependency static server for the igir report dashboard.
//   GET /api/reports        -> JSON list of CSV reports in REPORTS_DIR, newest first
//   GET /reports/<file>.csv -> raw report
//   GET /*                  -> files from ./public
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const reportsDir = path.resolve(process.env.REPORTS_DIR ?? path.join(root, 'reports'));
const port = Number(process.env.PORT ?? 8080);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function listReports() {
  const entries = await fs.readdir(reportsDir, { withFileTypes: true });
  const reports = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.csv'))
      .map(async (e) => {
        const stat = await fs.stat(path.join(reportsDir, e.name));
        // igir names reports after the run's unix timestamp; fall back to mtime otherwise.
        const stem = path.basename(e.name, path.extname(e.name));
        const time = /^\d{9,11}$/.test(stem) ? Number(stem) * 1000 : stat.mtimeMs;
        return { file: e.name, time, size: stat.size };
      }),
  );
  return reports.sort((a, b) => b.time - a.time);
}

// Resolve `relative` inside `dir`, refusing anything that escapes it.
function safeJoin(dir, relative) {
  const resolved = path.resolve(dir, '.' + path.sep + relative);
  return resolved === dir || resolved.startsWith(dir + path.sep) ? resolved : null;
}

async function sendFile(res, filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const decoded = decodeURIComponent(pathname);

  if (decoded === '/api/reports') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(await listReports()));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (decoded.startsWith('/reports/')) {
    const filePath = safeJoin(reportsDir, decoded.slice('/reports/'.length));
    return filePath ? sendFile(res, filePath) : res.writeHead(403).end();
  }

  const filePath = safeJoin(publicDir, decoded === '/' ? 'index.html' : decoded.slice(1));
  return filePath ? sendFile(res, filePath) : res.writeHead(403).end();
});

server.listen(port, () => {
  console.log(`igir dashboard: http://localhost:${port}  (reports from ${reportsDir})`);
});
