import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import yauzl from 'yauzl';
import { runZipMode, ensureDir } from '../src/cli';

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      resolve(zip);
    });
  });
}

function readZipEntries(filePath: string): Promise<Record<string, string>> {
  return new Promise(async (resolve, reject) => {
    try {
      const zip = await openZip(filePath);
      const out: Record<string, string> = {};
      zip.readEntry();
      zip.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err);
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c as Buffer));
          stream.on('end', () => {
            out[entry.fileName] = Buffer.concat(chunks).toString('utf8');
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', (e) => reject(e));
    } catch (e) {
      reject(e);
    }
  });
}

describe('runZipMode using yazl', () => {
  let tmpDir: string;
  let zipPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-backup-test-'));
    await ensureDir(tmpDir);
    zipPath = path.join(tmpDir, 'out.zip');
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('creates a valid zip with expected files', async () => {
    const files = [
      { name: 'a.txt', content: 'hello\n' },
      { name: 'dir/b.json', content: JSON.stringify({ x: 1 }) + '\n' },
    ];
    await runZipMode(zipPath, files);
    const entries = await readZipEntries(zipPath);
    expect(entries['a.txt']).toBe('hello\n');
    expect(entries['dir/b.json']).toBe('{"x":1}\n');
  });
});

