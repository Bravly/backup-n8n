import http = require('http');
import https = require('https');
import { URL } from 'url';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yazl = require('yazl');

type RequestFn = (method: string, url: string, headers?: any, body?: any) => Promise<any>;

export type DownloadOptions = {
  insecure?: boolean;
  pretty?: boolean;
  include?: {
    workflows?: boolean;
    users?: boolean;
    executions?: boolean;
    tags?: boolean;
    variables?: boolean;
    projects?: boolean;
  };
};

function slugify(s: any) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workflow';
}

function normalizeBase(baseUrl: string) {
  return baseUrl.replace(/\/$/, '');
}

export function makeRequester({ insecure = false }: { insecure?: boolean }): RequestFn {
  return function requestJSON(method: string, urlStr: string, headers: any = {}, body: any = null): Promise<any> {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const lib: any = isHttps ? https : http;
    const agent = isHttps ? new (https as any).Agent({ rejectUnauthorized: !insecure }) : undefined;
    const payload = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const options: any = {
      method,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: {
        'Accept': 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String((payload as any).length) } : {}),
        ...headers,
      },
      agent,
    };
    return new Promise((resolve, reject) => {
      const req = lib.request(options, (res: any) => {
        const chunks: Buffer[] = [] as any;
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}: ${text}`));
          }
          if (!text) return resolve(null);
          try {
            resolve(JSON.parse(text));
          } catch (e: any) {
            reject(new Error(`Failed to parse JSON: ${e.message}\n${text}`));
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}

async function fetchAllWorkflows(request: RequestFn, baseUrl: string, apiKey: string) {
  const headers = { 'X-N8N-API-KEY': apiKey, 'n8n-api-key': apiKey } as any;
  const url = `${baseUrl}/api/v1/workflows`;
  const data = await request('GET', url, headers);
  if (!data) return [] as any[];
  return Array.isArray(data) ? data : (Array.isArray((data as any).data) ? (data as any).data : []);
}

async function fetchWorkflowById(request: RequestFn, baseUrl: string, apiKey: string, id: string) {
  const headers = { 'X-N8N-API-KEY': apiKey, 'n8n-api-key': apiKey } as any;
  const url = `${baseUrl}/api/v1/workflows/${encodeURIComponent(id)}`;
  return request('GET', url, headers);
}

async function fetchList(request: RequestFn, baseUrl: string, apiKey: string, endpoint: string) {
  const headers = { 'X-N8N-API-KEY': apiKey, 'n8n-api-key': apiKey } as any;
  const url = `${baseUrl}${endpoint}`;
  const data = await request('GET', url, headers);
  if (!data) return [] as any[];
  return Array.isArray(data) ? data : (Array.isArray((data as any).data) ? (data as any).data : data);
}

async function zipToBuffer(files: { name: string; content: string | Buffer; mtime?: Date }[]) {
  const zip = new yazl.ZipFile();
  const now = new Date();
  for (const f of files) {
    const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
    zip.addBuffer(buf, f.name, { mtime: f.mtime || now });
  }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (d: Buffer) => chunks.push(d));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

export async function downloadBackup(baseUrl: string, apiKey: string, options: DownloadOptions = {}): Promise<Buffer> {
  const base = normalizeBase(baseUrl);
  const request = makeRequester({ insecure: !!options.insecure });
  const includeFlags = options.include || {};
  const anySelected = Object.values(includeFlags).some(Boolean);
  const include = {
    workflows: anySelected ? !!includeFlags.workflows : true,
    users: anySelected ? !!includeFlags.users : true,
    executions: anySelected ? !!includeFlags.executions : true,
    tags: anySelected ? !!includeFlags.tags : true,
    variables: anySelected ? !!includeFlags.variables : true,
    projects: anySelected ? !!includeFlags.projects : true,
  };

  // Workflows
  let list: any[] = [];
  if (include.workflows) {
    try {
      list = await fetchAllWorkflows(request, base, apiKey);
    } catch (e) {
      // Fail workflows fetch is critical to include workflows; still continue for other resources
      list = [];
    }
  }

  const filesToWrite: { name: string; content: string }[] = [];
  const results: any[] = [];
  if (include.workflows) {
    for (const item of list) {
      const id = (item.id ?? item._id ?? item.id?.toString?.() ?? String(item.id)) as string;
      const name = (item.name || `workflow-${id}`) as string;
      let full = item;
      if (!item.nodes || !item.connections) {
        try { full = await fetchWorkflowById(request, base, apiKey, id); } catch { continue; }
      }
      const fileName = `${String(id)}-${slugify(name)}.json`;
      const jsonText = (options.pretty ? JSON.stringify(full, null, 2) : JSON.stringify(full)) + '\n';
      filesToWrite.push({ name: `workflows/${fileName}`, content: jsonText });
      results.push({ id, name, file: fileName, active: !!full.active, updatedAt: full.updatedAt || full.updatedAt?.toString?.() });
    }
  }

  // Other resources (skip on error)
  const safeFetch = async (endpoint: string) => {
    try { return await fetchList(request, base, apiKey, endpoint); } catch { return []; }
  };
  const users = include.users ? await safeFetch('/api/v1/users') : [];
  const executions = include.executions ? await safeFetch('/api/v1/executions') : [];
  const tags = include.tags ? await safeFetch('/api/v1/tags') : [];
  const variables = include.variables ? await safeFetch('/api/v1/variables') : [];
  const projects = include.projects ? await safeFetch('/api/v1/projects') : [];

  const index = {
    baseUrl: base,
    counts: {
      workflows: results.length,
      users: (users as any[]).length,
      executions: (executions as any[]).length,
      tags: (tags as any[]).length,
      variables: (variables as any[]).length,
      projects: (projects as any[]).length,
    },
    generatedAt: new Date().toISOString(),
    workflows: results,
  } as any;

  const aggFiles: { name: string; content: string }[] = [];
  if (include.users && users) aggFiles.push({ name: 'users.json', content: JSON.stringify(users, null, 2) + '\n' });
  if (include.executions && executions) aggFiles.push({ name: 'executions.json', content: JSON.stringify(executions, null, 2) + '\n' });
  if (include.tags && tags) aggFiles.push({ name: 'tags.json', content: JSON.stringify(tags, null, 2) + '\n' });
  if (include.variables && variables) aggFiles.push({ name: 'variables.json', content: JSON.stringify(variables, null, 2) + '\n' });
  if (include.projects && projects) aggFiles.push({ name: 'projects.json', content: JSON.stringify(projects, null, 2) + '\n' });

  const allFiles = [...filesToWrite, ...aggFiles, { name: 'index.json', content: JSON.stringify(index, null, 2) + '\n' }];
  return zipToBuffer(allFiles);
}

