import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { makeRequester } from '../src/cli';

let baseUrl = '';
let server: http.Server;

describe('makeRequester', () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url === '/data') {
        res.writeHead(200); res.end(JSON.stringify({ ok: true })); return;
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

  it('performs a GET and parses JSON', async () => {
    const request = makeRequester({ insecure: false });
    const res = await request('GET', `${baseUrl}/data`);
    expect(res.ok).toBe(true);
  });
});

