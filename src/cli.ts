import fs = require("fs");
const fsp: any = (fs as any).promises;
import path = require("path");
import http = require("http");
import https = require("https");
import { URL } from "url";
// Use yazl for ZIP creation
// Using require to avoid TypeScript type issues if @types are absent
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yazl = require("yazl");

type RequestFn = (
  method: string,
  url: string,
  headers?: any,
  body?: any
) => Promise<any>;

// Minimal color helpers (no dependency). Honors TTY; disable via NO_COLOR.
const useColor = process.stdout && (process.env.NO_COLOR ? false : process.stdout.isTTY);
const wrap = (code: string, s: string) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const c = {
  bold: (s: string) => wrap('1', s),
  dim: (s: string) => wrap('2', s),
  red: (s: string) => wrap('31', s),
  green: (s: string) => wrap('32', s),
  yellow: (s: string) => wrap('33', s),
  cyan: (s: string) => wrap('36', s),
};
const sym = { ok: '✓', warn: '⚠', err: '✗', arrow: '→' };
const banner = () => {
  const line = c.cyan('┌───────────────────────────────┐');
  const title = c.cyan('│    ') + c.bold(c.cyan('n8n Backup CLI')) + c.cyan(' 🚀    │');
  const line2 = c.cyan('└───────────────────────────────┘');
  console.log(`${line}\n${title}\n${line2}`);
};

export function printHelp() {
  banner();
  const help = `\n${c.bold('Usage:')}\n  n8n-backup <baseUrl> <apiKey> [options]\n\n${c.bold('Positional:')}\n  baseUrl              Base URL of your n8n instance (e.g., https://n8n.example.com)\n  apiKey               n8n API key\n\n${c.bold('Options:')}\n  --out <path>         Output path. Default (zip): backups/n8n-<host>-<timestamp>.zip\n  --dir                Write all JSON files to a directory instead of a .zip\n  --pretty             Pretty-print JSON files\n  --insecure           Allow self-signed TLS certs (skip TLS validation)\n  --workflows          Include workflows\n  --users              Include users\n  --executions         Include executions\n  --tags               Include tags\n  --variables          Include variables\n  --projects           Include projects\n  -h, --help           Show help\n\n${c.bold('Notes:')}\n  - By default, all resources are exported (workflows, users, executions, tags, variables, projects).\n  - If any of the resource flags are set, only those resources are exported.\n  - Default output is a single .zip with per-workflow JSON files and aggregate JSON files for other resources.\n  - Use --dir to export plain JSON files into a directory instead of a .zip.\n  - License-restricted endpoints are skipped with a warning; export continues.\n`;
  console.log(help);
}

export function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const opts: any = { pretty: false, insecure: false, dir: false };
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') return { help: true } as any;
    if (a === '--pretty') { opts.pretty = true; continue; }
    if (a === '--insecure') { opts.insecure = true; continue; }
    if (a === '--dir') { opts.dir = true; continue; }
    if (a === '--out') { opts.out = args[++i]; continue; }
    if (a === '--workflows') { opts.workflows = true; continue; }
    if (a === '--users') { opts.users = true; continue; }
    if (a === '--executions') { opts.executions = true; continue; }
    if (a === '--tags') { opts.tags = true; continue; }
    if (a === '--variables') { opts.variables = true; continue; }
    if (a === '--projects') { opts.projects = true; continue; }
    positionals.push(a);
  }
  if (positionals.length < 2) return { error: 'Missing arguments: baseUrl and apiKey are required.' } as any;
  const baseUrl = positionals[0];
  const apiKey = positionals[1];
  return { baseUrl, apiKey, ...opts } as any;
}

export function slugify(s: any) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workflow"
  );
}

export function tsString(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function makeRequester({
  insecure = false,
}: {
  insecure?: boolean;
}): RequestFn {
  return function requestJSON(
    method: string,
    urlStr: string,
    headers: any = {},
    body: any = null
  ): Promise<any> {
    const u = new URL(urlStr);
    const isHttps = u.protocol === "https:";
    const lib: any = isHttps ? https : http;
    const agent = isHttps
      ? new (https as any).Agent({ rejectUnauthorized: !insecure })
      : undefined;
    const payload = body
      ? Buffer.from(typeof body === "string" ? body : JSON.stringify(body))
      : null;
    const options: any = {
      method,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ""),
      headers: {
        Accept: "application/json",
        ...(payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": String((payload as any).length),
            }
          : {}),
        ...headers,
      },
      agent,
    };
    return new Promise((resolve, reject) => {
      const req = lib.request(options, (res: any) => {
        const chunks: Buffer[] = [] as any;
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new Error(`HTTP ${res.statusCode} ${res.statusMessage}: ${text}`)
            );
          }
          if (!text) return resolve(null);
          try {
            resolve(JSON.parse(text));
          } catch (e: any) {
            reject(new Error(`Failed to parse JSON: ${e.message}\n${text}`));
          }
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}

export async function ensureDir(dir: string) {
  await (fsp as any).mkdir(dir, { recursive: true });
}

export async function writeJSON(filePath: string, obj: any, pretty: boolean) {
  const text = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  await ensureDir(path.dirname(filePath));
  await (fsp as any).writeFile(filePath, text + "\n");
}

function normalizeBase(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

export async function fetchAllWorkflows(
  request: RequestFn,
  baseUrl: string,
  apiKey: string
) {
  const headers = {
    "X-N8N-API-KEY": apiKey,
    "n8n-api-key": apiKey,
  } as any;
  const listUrl = `${baseUrl}/api/v1/workflows`;
  const data = await request("GET", listUrl, headers);
  if (!data) return [] as any[];
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data.data)
    ? data.data
    : [];
  return items;
}

export async function fetchWorkflowById(
  request: RequestFn,
  baseUrl: string,
  apiKey: string,
  id: string
) {
  const headers = {
    "X-N8N-API-KEY": apiKey,
    "n8n-api-key": apiKey,
  } as any;
  const url = `${baseUrl}/api/v1/workflows/${encodeURIComponent(id)}`;
  return request("GET", url, headers);
}

async function fetchList(
  request: RequestFn,
  baseUrl: string,
  apiKey: string,
  endpoint: string
) {
  const headers = {
    "X-N8N-API-KEY": apiKey,
    "n8n-api-key": apiKey,
  } as any;
  const url = `${baseUrl}${endpoint}`;
  const data = await request("GET", url, headers);
  if (!data) return [] as any[];
  return Array.isArray(data)
    ? data
    : Array.isArray((data as any).data)
    ? (data as any).data
    : data;
}

export async function runZipMode(
  outPath: string,
  files: { name: string; content: string }[]
) {
  const now = new Date();
  await ensureDir(path.dirname(outPath));
  const zip = new yazl.ZipFile();
  for (const f of files) {
    const buf = Buffer.from(f.content, "utf8");
    zip.addBuffer(buf, f.name, { mtime: now });
  }
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(outPath);
    out.on("error", reject);
    zip.outputStream.on("error", reject);
    out.on("close", () => resolve());
    zip.outputStream.pipe(out);
    zip.end();
  });
}

export async function main() {
  const parsed: any = parseArgs(process.argv as any);
  if (parsed.help) {
    printHelp();
    process.exit(0);
  }
  if (parsed.error) {
    console.error(c.red(parsed.error));
    printHelp();
    process.exit(1);
  }
  const { baseUrl, apiKey, out, pretty, insecure, dir } = parsed;
  const resourceFlags = {
    workflows: !!parsed.workflows,
    users: !!parsed.users,
    executions: !!parsed.executions,
    tags: !!parsed.tags,
    variables: !!parsed.variables,
    projects: !!parsed.projects,
  } as Record<string, boolean>;
  const anySelected = Object.values(resourceFlags).some(Boolean);
  const include = {
    workflows: anySelected ? !!resourceFlags.workflows : true,
    users: anySelected ? !!resourceFlags.users : true,
    executions: anySelected ? !!resourceFlags.executions : true,
    tags: anySelected ? !!resourceFlags.tags : true,
    variables: anySelected ? !!resourceFlags.variables : true,
    projects: anySelected ? !!resourceFlags.projects : true,
  };
  const base = normalizeBase(baseUrl);
  const request = makeRequester({ insecure });
  banner();

  const host = (() => {
    try {
      return new URL(base).hostname;
    } catch {
      return "n8n";
    }
  })();
  const defaultZip = path.join(
    process.cwd(),
    "backups",
    `n8n-${host}-${tsString()}.zip`
  );
  const defaultDir = path.join(
    process.cwd(),
    "backups",
    `n8n-${host}-${tsString()}`
  );

  console.log(`${c.cyan(sym.arrow + ' Connecting to')} ${c.bold(base)} ...`);
  let list: any[] = [];
  if (include.workflows) {
    try {
      list = await fetchAllWorkflows(request, base, apiKey);
    } catch (e: any) {
      console.error(c.red(`${sym.err} Failed to list workflows: ${e.message}`));
      process.exit(2);
    }
  }

  if (include.workflows) {
    if (!Array.isArray(list) || list.length === 0) {
      console.log(c.dim('No workflows found.'));
    } else {
      console.log(c.cyan(`Found ${list.length} workflows.`));
    }
  }

  const results: any[] = [];
  const filesToWrite: { name: string; content: string }[] = [];
  if (include.workflows) {
    for (const item of list) {
      const id = (item.id ??
        item._id ??
        item.id?.toString?.() ??
        String(item.id)) as string;
      const name = (item.name || `workflow-${id}`) as string;
      let full = item;
      if (!item.nodes || !item.connections) {
        try {
          full = await fetchWorkflowById(request, base, apiKey, id);
        } catch (e: any) {
        console.error(c.red(`  ${sym.err} ${name} (${id}): failed to fetch details: ${e.message}`));
          continue;
        }
      }
      const fileName = `${String(id)}-${slugify(name)}.json`;
      const jsonText =
        (pretty ? JSON.stringify(full, null, 2) : JSON.stringify(full)) + "\n";
      // Store workflows under a dedicated directory
      filesToWrite.push({
        name: path.posix.join("workflows", fileName),
        content: jsonText,
      });
      results.push({
        id,
        name,
        file: fileName,
        active: !!full.active,
        updatedAt: full.updatedAt || full.updatedAt?.toString?.(),
      });
    }
  }

  // Fetch other resources with graceful error handling (e.g., license restrictions)
  const fetchOrWarn = async (resource: string, endpoint: string) => {
    try {
      const items = await fetchList(request, base, apiKey, endpoint);
      return { items: Array.isArray(items) ? items : [], ok: true } as { items: any[]; ok: boolean };
    } catch (e: any) {
      console.error(c.yellow(`${sym.warn} Skipped ${resource}: ${e?.message || e}`));
      return { items: [], ok: false } as { items: any[]; ok: boolean };
    }
  };

  const [usersRes, executionsRes, tagsRes, variablesRes, projectsRes] = await Promise.all([
    include.users ? fetchOrWarn('users', '/api/v1/users') : Promise.resolve({ items: [], ok: false }),
    include.executions ? fetchOrWarn('executions', '/api/v1/executions') : Promise.resolve({ items: [], ok: false }),
    include.tags ? fetchOrWarn('tags', '/api/v1/tags') : Promise.resolve({ items: [], ok: false }),
    include.variables ? fetchOrWarn('variables', '/api/v1/variables') : Promise.resolve({ items: [], ok: false }),
    include.projects ? fetchOrWarn('projects', '/api/v1/projects') : Promise.resolve({ items: [], ok: false }),
  ]);

  const users = usersRes.items;
  const executions = executionsRes.items;
  const tags = tagsRes.items;
  const variables = variablesRes.items;
  const projects = projectsRes.items;

  const index = {
    baseUrl: base,
    counts: {
      workflows: results.length,
      users: users.length,
      executions: executions.length,
      tags: tags.length,
      variables: variables.length,
      projects: projects.length,
    },
    generatedAt: new Date().toISOString(),
    workflows: results,
  } as any;
  const indexText = JSON.stringify(index, null, 2) + "\n";

  if (dir) {
    const outDir = out || defaultDir;
    console.log(c.cyan(`Writing JSON files to: ${outDir}`));
    for (const f of filesToWrite) {
      await writeJSON(path.join(outDir, f.name), JSON.parse(f.content), pretty);
    }
    if (include.users && usersRes.ok)
      await writeJSON(path.join(outDir, "users.json"), users, true);
    if (include.executions && executionsRes.ok)
      await writeJSON(path.join(outDir, "executions.json"), executions, true);
    if (include.tags && tagsRes.ok)
      await writeJSON(path.join(outDir, "tags.json"), tags, true);
    if (include.variables && variablesRes.ok)
      await writeJSON(path.join(outDir, "variables.json"), variables, true);
    if (include.projects && projectsRes.ok)
      await writeJSON(path.join(outDir, "projects.json"), projects, true);
    await writeJSON(path.join(outDir, "index.json"), index, true);
    console.log(c.green(`${sym.ok} Done. Wrote data to ${path.join(outDir, "index.json")}`));
  } else {
    const outZip =
      out && out.endsWith(".zip")
        ? out
        : out
        ? path.join(out, `n8n-${host}-${tsString()}.zip`)
        : defaultZip;
    console.log(c.cyan(`Creating archive: ${outZip}`));
    const aggFiles: { name: string; content: string }[] = [];
    if (include.users && usersRes.ok)
      aggFiles.push({
        name: "users.json",
        content: JSON.stringify(users, null, 2) + "\n",
      });
    if (include.executions && executionsRes.ok)
      aggFiles.push({
        name: "executions.json",
        content: JSON.stringify(executions, null, 2) + "\n",
      });
    if (include.tags && tagsRes.ok)
      aggFiles.push({
        name: "tags.json",
        content: JSON.stringify(tags, null, 2) + "\n",
      });
    if (include.variables && variablesRes.ok)
      aggFiles.push({
        name: "variables.json",
        content: JSON.stringify(variables, null, 2) + "\n",
      });
    if (include.projects && projectsRes.ok)
      aggFiles.push({
        name: "projects.json",
        content: JSON.stringify(projects, null, 2) + "\n",
      });
    await runZipMode(outZip, [
      ...filesToWrite,
      ...aggFiles,
      { name: "index.json", content: indexText },
    ]);
    console.log(c.green(`${sym.ok} Done. Archived to ${outZip}`));
  }
}

if ((require as any).main === module) {
  main().catch((e: any) => {
    console.error("Unexpected error:", e);
    process.exit(1);
  });
}
