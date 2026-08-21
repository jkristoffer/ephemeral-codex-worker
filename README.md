# Ephemeral Codex Worker

This repository contains a small disposable Node.js worker for running Codex against a GitHub repository. Each invocation accepts one JSON job, creates a temporary workspace, clones the requested ref, runs Codex, prints one JSON result, and removes the workspace before exiting.

## Prerequisites

- Node.js 20 or newer
- Git
- The `codex` CLI available on `PATH`; no interactive login is required
- `OPENAI_API_KEY` in the environment
- `GITHUB_TOKEN` in the environment only when cloning a private repository

The worker does not use `codex login`, ChatGPT login, cached credentials, `~/.codex`, or OS keychain authentication.

## Fresh-machine setup

```text
install Node.js 20+
install Codex CLI
git clone https://github.com/jkristoffer/ephemeral-codex-worker.git
cd ephemeral-codex-worker
npm install
export OPENAI_API_KEY=...
npm run worker -- '<job-json>'
```

## Environment variables

- `OPENAI_API_KEY` is required. The worker fails validation before creating a workspace when it is absent or empty. It is passed to the Codex subprocess as the CLI's non-interactive environment credential.
- `GITHUB_TOKEN` is optional and is used only to authenticate Git when cloning a private GitHub repository.

Secrets enter only through environment variables. There is no built-in secrets provider or Infisical integration.

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
  "stderr": "...",
  "diff": "diff --git a/example.ts b/example.ts\n..."
}
```

After Codex succeeds, `diff` contains the redacted output of `git diff`; it is an empty string when the working tree has no tracked changes.

Validation errors, clone failures, subprocess spawn failures, Codex failures, diff failures, timeouts, cleanup failures, and worker errors use the same fields with `ok: false`. `stage` identifies `validation`, `clone`, `spawn`, `codex`, `diff`, `cleanup`, or `worker`; `exitCode` is `null` when a process could not start or was terminated without an exit code. A failure may also include an `error` string. A failed job exits with status `1`.

## Scripts

```bash
npm install
npm run typecheck
npm run build
npm run worker -- '<job-json>'
```

## Exact flow

1. Require `OPENAI_API_KEY`, then parse and validate the JSON argument.
2. Create a unique temporary workspace and an empty per-job Codex home.
3. Clone `https://github.com/owner/repository.git` at the requested ref.
4. If `GITHUB_TOKEN` is present, give Git an environment-based HTTP Authorization header; the token is never put in a URL or command argument.
5. Map `OPENAI_API_KEY` to the Codex CLI's non-interactive environment credential and run `codex exec` with persisted user configuration ignored.
6. Capture and redact subprocess output, including timeout and exit information.
7. If Codex succeeds, run `git diff` and capture its redacted output.
8. Delete the temporary directory in a `finally` block.
9. Emit the structured result and exit.

## Security behavior

- `OPENAI_API_KEY` and `GITHUB_TOKEN` are read from environment variables only; neither value is printed or written to disk by the worker.
- Codex receives a fresh disposable `CODEX_HOME` for every job, ignores user configuration, uses API-key-only authentication, and does not consult persisted login state.
- Authenticated Git configuration is passed through Git's `GIT_CONFIG_*` environment variables, so the remote URL remains public-looking.
- Values from sensitive environment variable names (including tokens, API keys, passwords, and auth headers) are redacted from captured output and returned errors.
- The clone is disposable, and cleanup runs after clone failures, spawn failures, and Codex timeouts as well as success. Cleanup failures are returned as a failed `cleanup` stage.
- Target repositories are executable input: Codex may run their scripts and dependencies. Use least-privilege, short-lived credentials.

## Scope and next milestone

This MVP intentionally excludes Docker packaging, Infisical integration, queues, databases, dashboards, servers, cloud orchestration, provider abstractions, and commit/push behavior. The next milestone is: clone -> Codex makes a trivial change -> create a branch -> commit -> push.
