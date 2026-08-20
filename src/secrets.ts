import { run } from "./process.js";

export type SecretMap = Record<string, string>;

export interface SecretProvider {
  load(profile: string): Promise<SecretMap>;
}

export class EnvSecretProvider implements SecretProvider {
  async load(): Promise<SecretMap> {
    return { ...process.env } as SecretMap;
  }
}

export class InfisicalCliSecretProvider implements SecretProvider {
  constructor(private readonly projectId = process.env.INFISICAL_PROJECT_ID) {}

  async load(profile: string): Promise<SecretMap> {
    if (!this.projectId) throw new Error("INFISICAL_PROJECT_ID is required");

    const result = await run("infisical", [
      "export",
      "--format=json",
      `--projectId=${this.projectId}`,
      `--env=${profile}`,
      "--silent",
    ]);

    if (result.code !== 0) {
      throw new Error(`Infisical export failed: ${result.stderr || result.stdout}`);
    }

    const parsed = JSON.parse(result.stdout) as Array<{ key: string; value: string }> | SecretMap;
    if (Array.isArray(parsed)) {
      return Object.fromEntries(parsed.map(({ key, value }) => [key, value]));
    }
    return parsed;
  }
}

export function getSecretProvider(): SecretProvider {
  return process.env.SECRET_PROVIDER === "infisical"
    ? new InfisicalCliSecretProvider()
    : new EnvSecretProvider();
}
