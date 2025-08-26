import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import yauzl from 'yauzl';
const N8N_KEY = 'integration_test_key';

function execNodeCli(args: string[], opts: { env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = execFile('node', [path.join(__dirname, '..', 'dist', 'cli.js'), ...args], { env: { ...process.env, ...(opts.env || {}) } });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function readZipEntries(filePath: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const out: Record<string, string> = {};
      zip.readEntry();
      zip.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) { zip.readEntry(); return; }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c as Buffer));
          stream.on('end', () => { out[entry.fileName] = Buffer.concat(chunks).toString('utf8'); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', (e) => reject(e));
    });
  });
}

describe('CLI integration (mock n8n)', () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpDir: string;
  const seenAuths: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', `http://${req.headers.host}`);
      const key = (req.headers['x-n8n-api-key'] || req.headers['n8n-api-key'] || '') as string;
      if (key) seenAuths.push(String(key));

      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && u.pathname === '/api/v1/workflows') {
        res.writeHead(200);
        res.end(JSON.stringify([
          { id: '1', name: 'Alpha' },
          { id: '2', name: 'Beta' },
        ]));
        return;
      }
      if (req.method === 'GET' && u.pathname === '/api/v1/users') {
        res.writeHead(200);
        res.end(JSON.stringify([{ id: 'u1', email: 'a@example.com' }]));
        return;
      }
      if (req.method === 'GET' && u.pathname === '/api/v1/executions') {
        res.writeHead(200);
        res.end(JSON.stringify([{ id: 'e1', workflowId: '1', status: 'success' }]));
        return;
      }
      if (req.method === 'GET' && u.pathname === '/api/v1/tags') {
        res.writeHead(200);
        res.end(JSON.stringify([{ id: 't1', name: 'tagA' }]));
        return;
      }
      if (req.method === 'GET' && u.pathname === '/api/v1/variables') {
        res.writeHead(200);
        res.end(JSON.stringify([{ id: 'v1', key: 'FOO', value: 'bar' }]));
        return;
      }
      if (req.method === 'GET' && u.pathname === '/api/v1/projects') {
        res.writeHead(200);
        res.end(JSON.stringify([{ id: 'p1', name: 'Project' }]));
        return;
      }
      if (req.method === 'GET' && u.pathname.startsWith('/api/v1/workflows/')) {
        const id = u.pathname.split('/').pop() as string;
        const wf = {
          id,
          name: id === '1' ? 'Alpha' : 'Beta',
          active: id === '1',
          updatedAt: new Date().toISOString(),
          nodes: [],
          connections: {},
        };
        res.writeHead(200);
        res.end(JSON.stringify(wf));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr && 'port' in addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-backup-int-'));

    // Ensure build exists for CLI
    const { execSync } = require('child_process');
    execSync('npm run build', { stdio: 'inherit' });
  });

  afterAll(async () => {
    try { server.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('archives workflows and other resources to a zip by default', async () => {
    const outZip = path.join(tmpDir, 'out.zip');
    const { code, stderr } = await execNodeCli([
      baseUrl,
      N8N_KEY,
      '--out', outZip,
      '--pretty', '--insecure'
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');

    expect(fs.existsSync(outZip)).toBe(true);
    const entries = await readZipEntries(outZip);
    expect(Object.keys(entries)).toContain('index.json');
    const index = JSON.parse(entries['index.json']);
    expect(index.counts.workflows).toBe(2);
    expect(Object.keys(entries)).toContain('workflows/1-alpha.json');
    expect(Object.keys(entries)).toContain('workflows/2-beta.json');
    expect(Object.keys(entries)).toContain('users.json');
    expect(Object.keys(entries)).toContain('executions.json');
    expect(Object.keys(entries)).toContain('tags.json');
    expect(Object.keys(entries)).toContain('variables.json');
    expect(Object.keys(entries)).toContain('projects.json');

    // headers include api key
    expect(seenAuths.some((v) => v === N8N_KEY)).toBe(true);
  });

  it('writes workflows and other resources to a directory with all options', async () => {
    const outDir = path.join(tmpDir, 'dir-out');
    const { code, stderr } = await execNodeCli([
      baseUrl,
      N8N_KEY,
      '--dir', '--pretty', '--insecure', '--out', outDir
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');

    const indexPath = path.join(outDir, 'index.json');
    const f1 = path.join(outDir, 'workflows', '1-alpha.json');
    const f2 = path.join(outDir, 'workflows', '2-beta.json');
    expect(fs.existsSync(indexPath)).toBe(true);
    expect(fs.existsSync(f1)).toBe(true);
    expect(fs.existsSync(f2)).toBe(true);
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    expect(index.counts.workflows).toBe(2);
    expect(fs.existsSync(path.join(outDir, 'users.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'executions.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'tags.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'variables.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'projects.json'))).toBe(true);
  });
});
