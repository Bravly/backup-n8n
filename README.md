**n8n Backup CLI**
- Simple Node.js CLI (TypeScript) to export/backup data from an n8n instance.

**Install/Run**
- Using npx (when published): `npx n8n-backup <baseUrl> <apiKey> [options]`
- From source: `node bin/n8n-backup.js <baseUrl> <apiKey> [options]`

**Usage**
- `n8n-backup <baseUrl> <apiKey> [--out path] [--dir] [--pretty] [--insecure] [--workflows] [--users] [--executions] [--tags] [--variables] [--projects]`
  - `baseUrl`: Base URL of your n8n instance (e.g., `https://n8n.example.com`).
  - `apiKey`: n8n API key.
  - `--out <path>`: Output path. Default is a `.zip` at `backups/n8n-<host>-<timestamp>.zip`. If `--dir` is set, this is an output directory.
  - `--dir`: Write all JSON files to a directory (non-zipped). Default is a single `.zip` archive.
  - `--pretty`: Pretty-print JSON
  - `--insecure`: Allow self-signed TLS certs

**What it does**
- Calls the n8n REST API to list workflows and fetch details for each workflow when needed.
- Default: creates a `.zip` containing:
  - Per-workflow JSON files under `workflows/` as `<id>-<slug(name)>.json`.
  - Aggregate JSON files for other resources: `users.json`, `executions.json`, `tags.json`, `variables.json`, `projects.json`.
  - An `index.json` summarizing counts.
- With `--dir`: writes JSON files directly into a directory and an `index.json`.

**Examples**
- Zip (default): `npx n8n-backup https://n8n.example.com abc123`
- Custom zip path: `npx n8n-backup https://n8n.example.com abc123 --out backups/my-n8n.zip`
- Directory output: `npx n8n-backup https://n8n.example.com abc123 --dir --out backups/my-n8n`

**Notes**
- The CLI sends both `X-N8N-API-KEY` and `n8n-api-key` headers for compatibility across n8n versions.

Resources and flags
- By default, all resources are exported: workflows, users, executions, tags, variables, projects.
- If any of the resource flags are set, only those resources are exported:
  - `--workflows`, `--users`, `--executions`, `--tags`, `--variables`, `--projects`

Output formats
- Zip (default): `n8n-backup https://n8n.example.com $N8N_API_KEY`
- Custom zip path: `n8n-backup https://n8n.example.com $N8N_API_KEY --out backups/my-n8n.zip`
- Directory output: `n8n-backup https://n8n.example.com $N8N_API_KEY --dir --out backups/my-n8n`
- License-restricted endpoints (e.g., projects on some licenses) are skipped with a warning; export continues.
- Credentials are not exported.
- Requires Node.js 16+.

UI and output
- The CLI prints a small banner and colored status lines when run in a TTY. Set `NO_COLOR=1` to disable.
- Example:
```
┌───────────────────────────────┐
│    n8n Backup CLI 🚀          │
└───────────────────────────────┘
→ Connecting to https://n8n.example.com ...
Found 12 workflows.
Creating archive: backups/n8n-example-20240101-120000.zip
✓ Done. Archived to backups/n8n-example-20240101-120000.zip
```
