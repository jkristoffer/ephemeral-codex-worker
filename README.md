# Ephemeral Codex Worker

This repository contains a small disposable Node.js worker for running Codex against a GitHub repository. Each invocation accepts one JSON job, creates a temporary workspace, clones the requested ref, runs Codex, prints one JSON result, and removes the workspace before exiting.

## Prerequisites

- Node.js 20 or newer
- Git
- The `codex` CLI available on `PATH` and configured for non-interactive use
- A GitHub token in `GITHUB_TOKEN` when cloning a private repository

The worker does not require Docker, a database, or an Infisical SDK. Infisical can supply environment variables outside the worker, for example with `infisical run`.

## Job

Pass exactly one JSON argument to `npm run worker`:

```json
{
  "repo": "owner/project",
  "goal": "Inspect the project and run its tests",
  "ref": "main",
  "timeoutSeconds": 1800
}
```

`repo` must be a GitHub `owner/repository` slug, not a URL. `goal` and `ref` must be non-empty strings. `ref` defaults to `main`; `timeoutSeconds` defaults to `1800` and must be a positive integer no greater than `3600`.

## Result

Every invocation writes one JSON object to stdout. Successful Codex execution has this shape:

```json
{
  "ok": true,
  "stage": "codex",
  "repo": "owner/project",
  "ref": "main",
  "exitCode": 0,
  "durationMs": 4210,
  "timedOut": false,
  "stdout": "...",
  "stderr": "..."
}
```

Validation errors, clone failures, subprocess spawn failures, Codex failures, timeouts, cleanup failures, and worker errors use the same fields with `ok: false`. `stage` identifies `validation`, `clone`, `spawn`, `codex`, `cleanup`, or `worker`; `exitCode` is `null` when a process could not start or was terminated without an exit code. A failure may also include an `error` string. A failed job exits with status `1`.

## Scripts

```bash
npm install
npm run typecheck
npm run build
npm run worker -- '<job-json>'
```

Infisical remains an external credential wrapper:

```bash
infisical run -- npm run worker -- '<job-json>'
infisical run -- npm run worker -- '{"repo":"owner/project","goal":"Run tests"}'
```

The wrapper should provide `GITHUB_TOKEN` (and any credentials needed by Codex) in the worker environment.

## Exact flow

1. Parse and validate the JSON argument.
2. Create a unique directory below the operating system temp directory.
3. Clone `https://github.com/owner/repository.git` at the requested ref.
4. If `GITHUB_TOKEN` is present, give Git an environment-based HTTP Authorization header; the token is never put in a URL or command argument.
5. Run `codex exec --approve-for-me --ephemeral -- <goal>` in the clone.
6. Capture and redact subprocess output, including timeout and exit information.
7. Delete the temporary directory in a `finally` block.
8. Emit the structured result and exit.

## Security behavior

- Tokens are read from environment variables only; no secret is written to disk by the worker.
- Authenticated Git configuration is passed through Git's `GIT_CONFIG_*` environment variables, so the remote URL remains public-looking.
- Values from sensitive environment variable names (including tokens, API keys, passwords, and auth headers) are redacted from captured output and returned errors.
- The clone is disposable, and cleanup runs after clone failures, spawn failures, and Codex timeouts as well as success. Cleanup failures are returned as a failed `cleanup` stage.
- Target repositories are executable input: Codex may run their scripts and dependencies. Use least-privilege, short-lived credentials.

## Scope and next milestone

This MVP intentionally excludes Docker packaging, Infisical integration, queues, databases, dashboards, servers, cloud orchestration, provider abstractions, and commit/push behavior. The next milestone is: clone -> Codex makes a trivial change -> create a branch -> commit -> push.
