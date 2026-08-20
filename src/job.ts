import { z } from "zod";

export const JobSchema = z.object({
  repo: z.string().min(1),
  goal: z.string().min(1),
  ref: z.string().default("main"),
  profile: z.string().default("default"),
  timeoutSeconds: z.number().int().positive().max(3600).default(1800),
});

export type Job = z.infer<typeof JobSchema>;

export function parseJob(raw: string): Job {
  return JobSchema.parse(JSON.parse(raw));
}
