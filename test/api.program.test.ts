import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';
import yauzl from 'yauzl';
import { downloadBackup } from '../src/api';

function readZipEntriesFromBuffer(buf: Buffer): Promise<Record<string,string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const out: Record<string,string> = {};
      zip.readEntry();
      zip.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) { zip.readEntry(); return; }
        zip.openReadStream(entry, (e, s) => {
          if (e || !s) return reject(e);
          const chunks: Buffer[] = [];
          s.on('data', (c) => chunks.push(c as Buffer));
          s.on('end', () => { out[entry.fileName] = Buffer.concat(chunks).toString('utf8'); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', (e) => reject(e));
    });
  });
}

describe('downloadBackup API', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', `http://${req.headers.host}`);
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && u.pathname === '/api/v1/workflows') {
        res.writeHead(200); res.end(JSON.stringify([{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }])); return;
      }
      if (req.method === 'GET' && u.pathname.startsWith('/api/v1/workflows/')) {
        const id = u.pathname.split('/').pop();
        res.writeHead(200); res.end(JSON.stringify({ id, name: id === '1' ? 'Alpha' : 'Beta', nodes: [], connections: {} })); return;
      }
      if (req.method === 'GET' && ['/api/v1/users','/api/v1/executions','/api/v1/tags','/api/v1/variables','/api/v1/projects'].includes(u.pathname)) {
        res.writeHead(200); res.end(JSON.stringify([])); return;
      }
      res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr && 'port' in addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns a zip buffer containing workflows and index', async () => {
    const buf = await downloadBackup(baseUrl, 'k', { pretty: true });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);
    const entries = await readZipEntriesFromBuffer(buf);
    expect(Object.keys(entries)).toContain('index.json');
    expect(Object.keys(entries)).toContain('workflows/1-alpha.json');
    expect(Object.keys(entries)).toContain('workflows/2-beta.json');
    const index = JSON.parse(entries['index.json']);
    expect(index.counts.workflows).toBe(2);
  });
});

