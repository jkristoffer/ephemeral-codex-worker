import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodex, redactText, type CommandResult } from "./codex.js";
import { cloneRepository } from "./git.js";

export const DEFAULT_REF = "main";
export const DEFAULT_TIMEOUT_SECONDS = 1_800;
export const MAX_TIMEOUT_SECONDS = 3_600;

export type Job = {
  repo: string;
  goal: string;
  ref: string;
  timeoutSeconds: number;
};

export type ResultStage = "validation" | "clone" | "spawn" | "codex" | "cleanup" | "worker";

export type WorkerResult = {
  ok: boolean;
  stage: ResultStage;
  repo?: string;
  ref?: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  error?: string;
};

const REPOSITORY_SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function parseJob(raw: unknown): Job {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("Provide exactly one JSON job argument");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Job argument must be valid JSON");
  }

  if (!isRecord(value)) throw new Error("Job must be a JSON object");

  const repo = value.repo;
  if (typeof repo !== "string" || !REPOSITORY_SLUG.test(repo)) {
    throw new Error("repo must be a GitHub owner/repository slug");
  }

  const goal = value.goal;
  if (typeof goal !== "string" || goal.trim().length === 0 || goal.includes("\0")) {
    throw new Error("goal must be a non-empty string");
  }

  const ref = value.ref === undefined ? DEFAULT_REF : value.ref;
  if (typeof ref !== "string" || ref.trim().length === 0 || ref.includes("\0")) {
    throw new Error("ref must be a non-empty string");
  }

  const timeoutSeconds = value.timeoutSeconds === undefined ? DEFAULT_TIMEOUT_SECONDS : value.timeoutSeconds;
  if (
    typeof timeoutSeconds !== "number" ||
    !Number.isFinite(timeoutSeconds) ||
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds <= 0 ||
    timeoutSeconds > MAX_TIMEOUT_SECONDS
  ) {
    throw new Error(`timeoutSeconds must be a positive integer no greater than ${MAX_TIMEOUT_SECONDS}`);
  }

  return {
    repo,
    goal,
    ref: ref.trim(),
    timeoutSeconds,
  };
}

export function validationFailure(error: unknown): WorkerResult {
  return {
    ok: false,
    stage: "validation",
    exitCode: null,
    durationMs: 0,
    timedOut: false,
    stdout: "",
    stderr: "",
    error: redactText(errorMessage(error)),
  };
}

export async function executeJob(job: Job): Promise<WorkerResult> {
  let root: string | undefined;
  const startedAt = Date.now();
  let result: WorkerResult = {
    ok: false,
    stage: "worker",
    repo: job.repo,
    ref: job.ref,
    exitCode: null,
    durationMs: 0,
    timedOut: false,
    stdout: "",
    stderr: "",
    error: "Worker did not produce a result",
  };

  try {
    root = await mkdtemp(join(tmpdir(), "ephemeral-codex-worker-"));
    const destination = join(root, "repository");
    const clone = await cloneRepository({
      repo: job.repo,
      ref: job.ref,
      destination,
      env: { ...process.env },
    });

    if (clone.spawnError) {
      result = commandFailure(job, "spawn", clone, clone.spawnError);
    } else if (clone.timedOut || clone.exitCode !== 0) {
      result = commandFailure(job, "clone", clone);
    } else {
      const codex = await runCodex({
        cwd: destination,
        goal: job.goal,
        env: { ...process.env },
        timeoutSeconds: job.timeoutSeconds,
      });
      result = codex.spawnError
        ? commandFailure(job, "spawn", codex, codex.spawnError)
        : commandFailure(job, "codex", codex);
    }
  } catch (error) {
    result = {
      ok: false,
      stage: "worker",
      repo: job.repo,
      ref: job.ref,
      exitCode: null,
      durationMs: Math.max(0, Date.now() - startedAt),
      timedOut: false,
      stdout: "",
      stderr: "",
      error: redactText(errorMessage(error)),
    };
  } finally {
    if (root) {
      try {
        await rm(root, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      } catch (error) {
        const cleanupError = redactText(errorMessage(error));
        result = {
          ...result,
          ok: false,
          stage: "cleanup",
          durationMs: Math.max(0, Date.now() - startedAt),
          error: [result.error, `Workspace cleanup failed: ${cleanupError}`].filter(Boolean).join("; "),
        };
      }
    }
  }

  return result;
}

function commandFailure(job: Job, stage: ResultStage, command: CommandResult, error?: string): WorkerResult {
  return {
    ok: stage === "codex" && command.exitCode === 0 && !command.timedOut,
    stage,
    repo: job.repo,
    ref: job.ref,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    timedOut: command.timedOut,
    stdout: command.stdout,
    stderr: command.stderr,
    ...(error || command.error ? { error: redactText(error ?? command.error ?? "") } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
