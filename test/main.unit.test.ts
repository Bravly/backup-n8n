import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { main } from '../src/cli';

function withServer(handlers: (req: http.IncomingMessage, res: http.ServerResponse, baseUrl: string) => void) {
  let server: http.Server;
  let baseUrl = '';
  return {
    async start() {
      server = http.createServer((req, res) => handlers(req, res, baseUrl));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address();
      const port = typeof addr === 'object' && addr && 'port' in addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      return baseUrl;
    },
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('main() unit via local server', () => {
  let originalArgv: string[];
  let originalExit: any;

  beforeEach(() => {
    originalArgv = process.argv.slice();
    originalExit = process.exit;
    // Prevent tests from killing the process in case of unexpected exit
    // @ts-ignore
    process.exit = (code?: number) => { throw new Error(`process.exit(${code})`); };
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  it('handles empty workflow list and writes index (dir mode)', async () => {
    const srv = withServer((req, res, baseUrl) => {
      const u = new URL(req.url || '/', baseUrl);
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && u.pathname === '/api/v1/workflows') {
        res.writeHead(200); res.end(JSON.stringify([])); return;
      }
      if (req.method === 'GET' && u.pathname.startsWith('/api/v1/')) {
        // Simulate license-restricted endpoints
        res.writeHead(403); res.end(JSON.stringify({ message: 'forbidden' })); return;
      }
      res.writeHead(404); res.end('{}');
    });
    const base = await srv.start();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-main-dir-'));
    process.argv = ['node', 'cli', base, 'k', '--dir', '--out', tmpDir, '--pretty'];
    await main();
    const indexPath = path.join(tmpDir, 'index.json');
    expect(fs.existsSync(indexPath)).toBe(true);
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    expect(index.counts.workflows).toBe(0);
    await srv.stop();
  });

  it('archives one workflow to zip (zip mode)', async () => {
    const srv = withServer((req, res, baseUrl) => {
      const u = new URL(req.url || '/', baseUrl);
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && u.pathname === '/api/v1/workflows') {
        res.writeHead(200); res.end(JSON.stringify([{ id: '1', name: 'Alpha' }])); return;
      }
      if (req.method === 'GET' && u.pathname === '/api/v1/workflows/1') {
        res.writeHead(200); res.end(JSON.stringify({ id: '1', name: 'Alpha', nodes: [], connections: {} })); return;
      }
      if (req.method === 'GET' && u.pathname.startsWith('/api/v1/')) {
        res.writeHead(200); res.end(JSON.stringify([])); return;
      }
      res.writeHead(404); res.end('{}');
    });
    const base = await srv.start();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-main-zip-'));
    const outZip = path.join(tmpDir, 'out.zip');
    process.argv = ['node', 'cli', base, 'k', '--out', outZip];
    await main();
    expect(fs.existsSync(outZip)).toBe(true);
    await srv.stop();
  });
});

