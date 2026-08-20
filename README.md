# Ephemeral Codex Worker

A disposable worker runtime for running Codex against a repository with scoped runtime credentials.

## MVP flow

```text
JSON job
  -> temporary workspace
  -> load secrets (environment or Infisical CLI)
  -> clone repository
  -> run Codex non-interactively
  -> emit JSON result
  -> delete workspace
  -> exit
```

## Job format

```json
{
  "repo": "owner/project",
  "goal": "Inspect the project and run its tests",
  "ref": "main",
  "profile": "dev",
  "timeoutSeconds": 1800
}
```

`ref`, `profile`, and `timeoutSeconds` are optional.

## Local development

Requirements: Node.js 20+, Git, and Codex CLI. Infisical CLI is required only when `SECRET_PROVIDER=infisical`.

```bash
npm install
cp .env.example .env
npm run dev -- '{"repo":"owner/project","goal":"Inspect the project and run its tests"}'
```

For a private GitHub repository, provide `GITHUB_TOKEN` with access to that repository.

## Docker

```bash
docker build -t ephemeral-codex-worker .

docker run --rm \
  -e OPENAI_API_KEY \
  -e GITHUB_TOKEN \
  ephemeral-codex-worker \
  '{"repo":"owner/project","goal":"Inspect the project and run its tests"}'
```

## Infisical

Set `SECRET_PROVIDER=infisical`, `INFISICAL_PROJECT_ID`, and an authenticated `INFISICAL_TOKEN`. The worker runs `infisical export --format=json --projectId=... --env=...` and merges the returned secrets into the subprocess environment. Infisical documents `INFISICAL_TOKEN` as the non-interactive authentication mechanism for machine identities/service tokens.

```bash
docker run --rm \
  -e SECRET_PROVIDER=infisical \
  -e INFISICAL_PROJECT_ID \
  -e INFISICAL_TOKEN \
  ephemeral-codex-worker \
  '{"repo":"owner/project","goal":"Run tests","profile":"dev"}'
```

For the hosted version, the intended design is workload identity/OIDC -> short-lived Infisical token rather than a long-lived token baked into the image.

## Current scope

This repository intentionally does not yet include queues, Cloud Run Jobs, Oracle/OCI, Terraform, SSH orchestration, dashboards, or persistent job storage. Those come after the local disposable-worker loop is reliable.

## Security notes

- Never commit secrets.
- Give GitHub tokens access only to repositories the worker needs.
- Use separate Infisical environments/profiles for dev, staging, and production.
- Treat target repositories as executable input: Codex can run their scripts and dependencies.
- Prefer short-lived credentials and disposable compute.
