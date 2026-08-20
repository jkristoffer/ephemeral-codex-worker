import { run } from "./process.js";

export type CodexResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export async function runCodex(params: {
  cwd: string;
  goal: string;
  env: NodeJS.ProcessEnv;
  timeoutSeconds: number;
}): Promise<CodexResult> {
  return run(
    "codex",
    ["exec", "--full-auto", params.goal],
    {
      cwd: params.cwd,
      env: params.env,
      timeoutMs: params.timeoutSeconds * 1000,
    },
  );
}
