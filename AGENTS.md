# Ephemeral Codex Worker

## Goal
Build a reusable disposable worker that accepts a repository + goal, obtains scoped runtime credentials, executes Codex inside an isolated workspace, returns structured results, and exits cleanly.

## MVP constraints
- Keep the worker generic; project-specific logic belongs in target repositories.
- Do not persist secrets to disk unless unavoidable.
- Never log secret values or authenticated repository URLs.
- Temporary workspaces must be deleted after each job.
- Prefer explicit adapters for Codex, secrets, git, and future compute providers.
- Avoid adding queues, databases, dashboards, Cloud Run, OCI, or Terraform until the local Docker worker is reliable.

## Definition of done for v1
A Docker container can accept a JSON job, fetch credentials from Infisical or environment fallback, clone a repository, invoke Codex non-interactively, emit a machine-readable result, and terminate.
