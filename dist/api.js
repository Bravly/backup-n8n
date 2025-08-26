"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadBackup = exports.makeRequester = void 0;
const http = require("http");
const https = require("https");
const url_1 = require("url");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yazl = require('yazl');
function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workflow';
}
function normalizeBase(baseUrl) {
    return baseUrl.replace(/\/$/, '');
}
function makeRequester({ insecure = false }) {
    return function requestJSON(method, urlStr, headers = {}, body = null) {
        const u = new url_1.URL(urlStr);
        const isHttps = u.protocol === 'https:';
        const lib = isHttps ? https : http;
        const agent = isHttps ? new https.Agent({ rejectUnauthorized: !insecure }) : undefined;
        const payload = body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null;
        const options = {
            method,
            hostname: u.hostname,
            port: u.port || (isHttps ? 443 : 80),
            path: u.pathname + (u.search || ''),
            headers: {
                'Accept': 'application/json',
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
                ...headers,
            },
            agent,
        };
        return new Promise((resolve, reject) => {
            const req = lib.request(options, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    const text = buf.toString('utf8');
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        return reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}: ${text}`));
                    }
                    if (!text)
                        return resolve(null);
                    try {
                        resolve(JSON.parse(text));
                    }
                    catch (e) {
                        reject(new Error(`Failed to parse JSON: ${e.message}\n${text}`));
                    }
                });
            });
            req.on('error', reject);
            if (payload)
                req.write(payload);
            req.end();
        });
    };
}
exports.makeRequester = makeRequester;
async function fetchAllWorkflows(request, baseUrl, apiKey) {
    const headers = { 'X-N8N-API-KEY': apiKey, 'n8n-api-key': apiKey };
    const url = `${baseUrl}/api/v1/workflows`;
    const data = await request('GET', url, headers);
    if (!data)
        return [];
    return Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
}
async function fetchWorkflowById(request, baseUrl, apiKey, id) {
    const headers = { 'X-N8N-API-KEY': apiKey, 'n8n-api-key': apiKey };
    const url = `${baseUrl}/api/v1/workflows/${encodeURIComponent(id)}`;
    return request('GET', url, headers);
}
async function fetchList(request, baseUrl, apiKey, endpoint) {
    const headers = { 'X-N8N-API-KEY': apiKey, 'n8n-api-key': apiKey };
    const url = `${baseUrl}${endpoint}`;
    const data = await request('GET', url, headers);
    if (!data)
        return [];
    return Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : data);
}
async function zipToBuffer(files) {
    const zip = new yazl.ZipFile();
    const now = new Date();
    for (const f of files) {
        const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
        zip.addBuffer(buf, f.name, { mtime: f.mtime || now });
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        zip.outputStream.on('data', (d) => chunks.push(d));
        zip.outputStream.on('error', reject);
        zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
        zip.end();
    });
}
async function downloadBackup(baseUrl, apiKey, options = {}) {
    var _a, _b, _c, _d, _e, _f, _g;
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
    let list = [];
    if (include.workflows) {
        try {
            list = await fetchAllWorkflows(request, base, apiKey);
        }
        catch (e) {
            // Fail workflows fetch is critical to include workflows; still continue for other resources
            list = [];
        }
    }
    const filesToWrite = [];
    const results = [];
    if (include.workflows) {
        for (const item of list) {
            const id = ((_e = (_b = (_a = item.id) !== null && _a !== void 0 ? _a : item._id) !== null && _b !== void 0 ? _b : (_d = (_c = item.id) === null || _c === void 0 ? void 0 : _c.toString) === null || _d === void 0 ? void 0 : _d.call(_c)) !== null && _e !== void 0 ? _e : String(item.id));
            const name = (item.name || `workflow-${id}`);
            let full = item;
            if (!item.nodes || !item.connections) {
                try {
                    full = await fetchWorkflowById(request, base, apiKey, id);
                }
                catch {
                    continue;
                }
            }
            const fileName = `${String(id)}-${slugify(name)}.json`;
            const jsonText = (options.pretty ? JSON.stringify(full, null, 2) : JSON.stringify(full)) + '\n';
            filesToWrite.push({ name: `workflows/${fileName}`, content: jsonText });
            results.push({ id, name, file: fileName, active: !!full.active, updatedAt: full.updatedAt || ((_g = (_f = full.updatedAt) === null || _f === void 0 ? void 0 : _f.toString) === null || _g === void 0 ? void 0 : _g.call(_f)) });
        }
    }
    // Other resources (skip on error)
    const safeFetch = async (endpoint) => {
        try {
            return await fetchList(request, base, apiKey, endpoint);
        }
        catch {
            return [];
        }
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
            users: users.length,
            executions: executions.length,
            tags: tags.length,
            variables: variables.length,
            projects: projects.length,
        },
        generatedAt: new Date().toISOString(),
        workflows: results,
    };
    const aggFiles = [];
    if (include.users && users)
        aggFiles.push({ name: 'users.json', content: JSON.stringify(users, null, 2) + '\n' });
    if (include.executions && executions)
        aggFiles.push({ name: 'executions.json', content: JSON.stringify(executions, null, 2) + '\n' });
    if (include.tags && tags)
        aggFiles.push({ name: 'tags.json', content: JSON.stringify(tags, null, 2) + '\n' });
    if (include.variables && variables)
        aggFiles.push({ name: 'variables.json', content: JSON.stringify(variables, null, 2) + '\n' });
    if (include.projects && projects)
        aggFiles.push({ name: 'projects.json', content: JSON.stringify(projects, null, 2) + '\n' });
    const allFiles = [...filesToWrite, ...aggFiles, { name: 'index.json', content: JSON.stringify(index, null, 2) + '\n' }];
    return zipToBuffer(allFiles);
}
exports.downloadBackup = downloadBackup;
