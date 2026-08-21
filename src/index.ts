#!/usr/bin/env node
import { redactText } from "./codex.js";
import { executeJob, parseJob, validationFailure, type WorkerResult } from "./workspace.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    writeResult(validationFailure(new Error("Provide exactly one JSON job argument")));
    return;
  }

  const rawJob = args[0];
  let job;

  try {
    job = parseJob(rawJob);
  } catch (error) {
    writeResult(validationFailure(error));
    return;
  }

  writeResult(await executeJob(job));
}

function writeResult(result: WorkerResult): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error: unknown) => {
  writeResult({
    ok: false,
    stage: "worker",
    exitCode: null,
    durationMs: 0,
    timedOut: false,
    stdout: "",
    stderr: "",
    error: redactText(error instanceof Error ? error.message : String(error)),
  });
});
