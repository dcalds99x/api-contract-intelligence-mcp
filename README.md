# API Contract Intelligence MCP

A local MCP server that connects breaking changes in OpenAPI contracts to direct TypeScript calls made with `openapi-fetch`. The project is at v0.1: its analysis reports verifiable evidence and states its limitations. It does not claim to find every consumer or to prove that a detected call is broken.

## Requirements

- Node.js 20.11 or later
- `oasdiff` installed and available on `PATH`

Install the official [oasdiff binary](https://github.com/oasdiff/oasdiff#installation) for your operating system. The server never downloads or runs an on-demand installation.

## Development

```bash
npm install
npm run dev
```

To build the project, run `npm run build`, then run `npm start`.

## MCP Tools

- `analyze_contract_changes`: compares `baseSpec` and `headSpec` and normalizes breaking changes.
- `find_endpoint_consumers`: finds consumers for a `method` + `path` pair.
- `analyze_change_impact`: combines both analyses and reports their limitations.

All tools accept `projectRoot` (defaults to `.`); contract paths and `tsconfig` are relative to this root. For security, the root must stay inside the process working directory, or inside `API_CONTRACT_ROOT` when set. Absolute paths, paths outside the root, and external `$ref` references are rejected. Internal `#/...` references are allowed. Contracts larger than 5 MiB, projects with more than 10,000 TypeScript files, and comparisons that exceed 30 seconds are rejected or terminated.

The indexer recognizes literal calls such as `client.GET("/users/{id}", ...)` when `client` is created by the default or named `createClient` import from `openapi-fetch`. Wrappers, dynamic URLs, response property usage, and other clients are not tracked. Contract changes include their `ERR` or `WARN` severity as reported by `oasdiff`.

## MCP Configuration Example

In Codex, add a stdio server in Settings → MCP servers, or add this to `~/.codex/config.toml`:

```toml
[mcp_servers.api_contract_intelligence]
command = "node"
args = ["C:/path/to/Contract API - MCP/dist/index.js"]
cwd = "C:/path/to/Contract API - MCP"

[mcp_servers.api_contract_intelligence.env]
API_CONTRACT_ROOT = "C:/path/to/Contract API - MCP"
```

Build the project with `npm run build` before connecting. During development, use `npx tsx src/index.ts`. The protocol uses stdio; application logs must go to stderr, never stdout.
