#!/usr/bin/env node
import { parseJob } from "./job.js";
import { executeJob } from "./worker.js";

async function main() {
  const raw = process.argv[2] ?? process.env.WORKER_JOB;
  if (!raw) {
    throw new Error('Provide a JSON job as argv[2] or WORKER_JOB. Example: {"repo":"owner/repo","goal":"Run tests"}');
  }

  const job = parseJob(raw);
  const result = await executeJob(job);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : result.exitCode || 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
  process.exitCode = 1;
});
