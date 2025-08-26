import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile, execSync } from 'child_process';
import yauzl from 'yauzl';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env') });

const N8N_BASE = process.env.N8N_BASE;
const N8N_API_KEY = process.env.N8N_API_KEY;

function execNodeCli(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = execFile('node', [path.join(__dirname, '..', 'dist', 'cli.js'), ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += String(d)));
    child.stderr?.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function readZipEntry(filePath: string, entryName: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      let found = false;
      zip.readEntry();
      zip.on('entry', (entry) => {
        if (entry.fileName === entryName) {
          found = true;
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) return reject(e);
            const chunks: Buffer[] = [];
            stream.on('data', (c) => chunks.push(c as Buffer));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on('end', () => resolve(found ? null : null));
      zip.on('error', (e) => reject(e));
    });
  });
}

const hasReal = !!(N8N_BASE && N8N_API_KEY);

describe('Real n8n integration (optional)', () => {
  beforeAll(() => {
    // Ensure we have a build
    execSync('npm run build', { stdio: 'inherit' });
  });

  (hasReal ? it : it.skip)('exports to zip (default, all resources, tolerate restricted)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-real-zip-'));
    const outZip = path.join(tmpDir, 'out.zip');

    const { code, stderr } = await execNodeCli([
      N8N_BASE as string,
      N8N_API_KEY as string,
      '--out', outZip,
      '--pretty', '--insecure',
      '--workflows', '--users', '--executions', '--tags', '--variables', '--projects'
    ]);
    expect(code).toBe(0);
    // stderr may contain warnings for license-restricted endpoints; do not assert empty
    expect(fs.existsSync(outZip)).toBe(true);

    const indexText = await readZipEntry(outZip, 'index.json');
    expect(indexText).not.toBeNull();
    if (indexText) {
      const index = JSON.parse(indexText);
      expect(index).toBeTypeOf('object');
      expect(index.baseUrl).toBeTypeOf('string');
      expect(index.counts).toBeTypeOf('object');
    }
  });

  (hasReal ? it : it.skip)('exports to directory (all resources, tolerate restricted)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-real-dir-'));
    const outDir = path.join(tmpDir, 'out');

    const { code, stderr } = await execNodeCli([
      N8N_BASE as string,
      N8N_API_KEY as string,
      '--dir', '--out', outDir,
      '--pretty', '--insecure',
      '--workflows', '--users', '--executions', '--tags', '--variables', '--projects'
    ]);
    expect(code).toBe(0);
    // stderr may contain warnings for license-restricted endpoints; do not assert empty
    const indexPath = path.join(outDir, 'index.json');
    expect(fs.existsSync(indexPath)).toBe(true);
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    expect(index).toBeTypeOf('object');
    expect(index.counts).toBeTypeOf('object');
  });
});
