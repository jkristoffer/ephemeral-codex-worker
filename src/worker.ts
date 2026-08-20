import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./process.js";
import { getSecretProvider } from "./secrets.js";
import { runCodex } from "./codex.js";
import type { Job } from "./job.js";

export type WorkerResult = {
  ok: boolean;
  repo: string;
  ref: string;
  profile: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function executeJob(job: Job): Promise<WorkerResult> {
  const root = await mkdtemp(join(tmpdir(), "codex-worker-"));
  const workspace = join(root, "workspace");

  try {
    const secrets = await getSecretProvider().load(job.profile);
    const env = { ...process.env, ...secrets };

    const repoUrl = buildRepoUrl(job.repo, env.GITHUB_TOKEN);
    const clone = await run("git", ["clone", "--depth", "1", "--branch", job.ref, repoUrl, workspace], {
      env,
      timeoutMs: 120_000,
    });

    if (clone.code !== 0) {
      return {
        ok: false,
        repo: job.repo,
        ref: job.ref,
        profile: job.profile,
        exitCode: clone.code,
        stdout: clone.stdout,
        stderr: clone.stderr,
      };
    }

    const result = await runCodex({
      cwd: workspace,
      goal: job.goal,
      env,
      timeoutSeconds: job.timeoutSeconds,
    });

    return {
      ok: result.code === 0,
      repo: job.repo,
      ref: job.ref,
      profile: job.profile,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function buildRepoUrl(repo: string, token?: string): string {
  if (repo.startsWith("http://") || repo.startsWith("https://") || repo.startsWith("git@")) {
    return repo;
  }

  if (token) {
    return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repo}.git`;
  }

  return `https://github.com/${repo}.git`;
}
