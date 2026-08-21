import { Buffer } from "node:buffer";
import { runCommand, type CommandResult } from "./codex.js";

const CLONE_TIMEOUT_MS = 120_000;

export async function cloneRepository(params: {
  repo: string;
  ref: string;
  destination: string;
  env: NodeJS.ProcessEnv;
}): Promise<CommandResult> {
  const token = params.env.GITHUB_TOKEN;
  const auth = token ? createAuthConfig(token) : undefined;
  const env: NodeJS.ProcessEnv = {
    ...params.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_TRACE: "0",
    GIT_TRACE_CURL: "0",
    GIT_CURL_VERBOSE: "0",
    GIT_TRACE_PACKET: "0",
    GIT_TRACE_PERFORMANCE: "0",
    GIT_TRACE2: "0",
    GIT_TRACE2_EVENT: "0",
    GIT_TRACE2_PERF: "0",
  };

  if (auth) {
    const configIndex = configCount(env.GIT_CONFIG_COUNT);
    env.GIT_CONFIG_COUNT = String(configIndex + 1);
    env[`GIT_CONFIG_KEY_${configIndex}`] = "http.https://github.com/.extraheader";
    env[`GIT_CONFIG_VALUE_${configIndex}`] = auth.header;
  }

  return runCommand(
    "git",
    ["clone", "--depth", "1", "--no-tags", "--branch", params.ref, `https://github.com/${params.repo}.git`, params.destination],
    {
      env,
      timeoutMs: CLONE_TIMEOUT_MS,
      redactValues: auth ? [token ?? "", auth.header, auth.encodedToken] : [],
    },
  );
}

function createAuthConfig(token: string): { header: string; encodedToken: string } | undefined {
  if (token.length === 0) return undefined;
  const encodedToken = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return {
    encodedToken,
    header: `AUTHORIZATION: basic ${encodedToken}`,
  };
}

function configCount(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
