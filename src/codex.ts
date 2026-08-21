import { spawn, type ChildProcess } from "node:child_process";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  spawnError?: string;
  error?: string;
};

type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  redactValues?: readonly string[];
};

const SENSITIVE_ENV_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL|AUTH|GIT_CONFIG_VALUE)/i;
const TIMEOUT_GRACE_MS = 5_000;

/**
 * Run a child process without a shell and retain only redacted output.
 * The force-settle timer keeps a stuck child from holding the worker open.
 */
export function runCommand(command: string, args: readonly string[], options: RunOptions = {}): Promise<CommandResult> {
  const startedAt = Date.now();
  const env = options.env ?? process.env;
  const redactValues = sensitiveValues(env, options.redactValues);

  return new Promise((resolve) => {
    let child: ChildProcess;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let forceKillHandle: NodeJS.Timeout | undefined;
    let forceSettleHandle: NodeJS.Timeout | undefined;

    const finish = (result: Omit<CommandResult, "stdout" | "stderr" | "durationMs" | "timedOut"> & { timedOut?: boolean }) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (forceKillHandle) clearTimeout(forceKillHandle);
      if (forceSettleHandle) clearTimeout(forceSettleHandle);

      resolve({
        stdout: redactText(stdout, redactValues),
        stderr: redactText(stderr, redactValues),
        exitCode: result.exitCode,
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut: result.timedOut ?? timedOut,
        ...(result.spawnError ? { spawnError: redactText(result.spawnError, redactValues) } : {}),
        ...(result.error ? { error: redactText(result.error, redactValues) } : {}),
      });
    };

    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish({ exitCode: null, spawnError: errorMessage(error) });
      return;
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      finish({ exitCode: null, spawnError: errorMessage(error) });
    });

    child.once("close", (exitCode, signal) => {
      const error = timedOut
        ? `Process timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)} seconds`
        : signal
          ? `Process terminated by ${signal}`
          : undefined;
      finish({ exitCode, error });
    });

    if (options.timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminate(child, "SIGTERM");

        forceKillHandle = setTimeout(() => {
          if (settled) return;
          terminate(child, "SIGKILL");
          // close normally follows SIGKILL, but never let cleanup wait forever.
          forceSettleHandle = setTimeout(() => {
            finish({
              exitCode: null,
              timedOut: true,
              error: `Process timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)} seconds`,
            });
          }, 1_000);
        }, TIMEOUT_GRACE_MS);
      }, options.timeoutMs);
    }
  });
}

export async function runCodex(params: {
  cwd: string;
  goal: string;
  env: NodeJS.ProcessEnv;
  timeoutSeconds: number;
}): Promise<CommandResult> {
  return runCommand("codex", ["exec", "--approve-for-me", "--ephemeral", "--", params.goal], {
    cwd: params.cwd,
    env: params.env,
    timeoutMs: params.timeoutSeconds * 1_000,
  });
}

export function redactText(value: string, values: readonly string[] = sensitiveValues(process.env)): string {
  let redacted = value;
  for (const secret of values) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  return redacted;
}

function sensitiveValues(env: NodeJS.ProcessEnv, additional: readonly string[] = []): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (value && SENSITIVE_ENV_NAME.test(name)) values.add(value);
  }
  for (const value of additional) {
    if (value) values.add(value);
  }
  return [...values].sort((left, right) => right.length - left.length);
}

function terminate(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child if the process group is already gone.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // The process may have exited between timeout handling and kill.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
