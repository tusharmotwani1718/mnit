import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Cond, FactDef, Scheme } from "./types.js";

export const DEFAULT_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data");

const localized = z.object({ hi: z.string().min(1), mr: z.string().min(1), en: z.string().min(1) });
const factValue = z.union([z.string(), z.number(), z.boolean()]);

const factDefSchema = z.object({
  type: z.enum(["enum", "boolean", "number", "string"]),
  values: z.array(z.string()).optional(),
  askable: z.boolean(),
  priority: z.number().optional(),
  description: z.string().optional(),
  ask: localized.optional(),
  derives: z.array(z.object({ when: factValue, set: z.record(z.string(), factValue) })).optional(),
  topics: z.array(z.string()).optional(),
  unitNormalisation: z.unknown().optional(),
});

const vocabularySchema = z.object({
  version: z.number(),
  facts: z.record(z.string(), factDefSchema),
});

const condSchema: z.ZodType<Cond> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(condSchema).min(1) }).strict(),
    z.object({ any: z.array(condSchema).min(1) }).strict(),
    z.object({ not: condSchema }).strict(),
    z.object({ manualCheck: z.string().min(1) }).strict(),
    z
      .object({
        fact: z.string(),
        op: z.enum(["eq", "lte", "gte", "in"]),
        value: z.unknown(),
        assumeIfUnknown: z.boolean().optional(),
        caveat: localized.optional(),
      })
      .strict(),
  ]),
);

const schemeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: localized,
    level: z.enum(["central", "state"]),
    state: z.string().optional(),
    tier: z.union([z.literal(1), z.literal(2)]),
    topics: z.array(z.string()).min(1),
    rules: condSchema,
    benefitSummary: localized,
    documents: z.array(localized),
    applyAt: z.array(z.string()),
    applyAtSpoken: localized,
    helpline: z.string().nullable(),
    source: z.string().url(),
    status: z.enum(["draft", "approved", "needs_review"]),
  })
  .passthrough();

export function loadVocabulary(dataDir = DEFAULT_DATA_DIR): Record<string, FactDef> {
  const raw = JSON.parse(readFileSync(join(dataDir, "facts.json"), "utf8"));
  return vocabularySchema.parse(raw).facts as Record<string, FactDef>;
}

/** Checks a rule tree against the fact vocabulary; returns human-readable problems. */
export function checkRules(cond: Cond, facts: Record<string, FactDef>, path = "rules"): string[] {
  if ("all" in cond) return cond.all.flatMap((c, i) => checkRules(c, facts, `${path}.all[${i}]`));
  if ("any" in cond) return cond.any.flatMap((c, i) => checkRules(c, facts, `${path}.any[${i}]`));
  if ("not" in cond) {
    const inner = checkRules(cond.not, facts, `${path}.not`);
    return hasAssumption(cond.not) ? [...inner, `${path}: assumeIfUnknown is not allowed under "not"`] : inner;
  }
  if ("manualCheck" in cond) return [];

  const def = facts[cond.fact];
  if (!def) return [`${path}: unknown fact "${cond.fact}"`];
  const problems: string[] = [];
  if (cond.assumeIfUnknown && def.askable) problems.push(`${path}: assumeIfUnknown on askable fact "${cond.fact}"`);
  if (cond.assumeIfUnknown && !cond.caveat) problems.push(`${path}: assumeIfUnknown without caveat`);
  if ((cond.op === "lte" || cond.op === "gte") && def.type !== "number")
    problems.push(`${path}: ${cond.op} on non-number fact "${cond.fact}"`);
  if (def.type === "enum" && def.values) {
    const vals = cond.op === "in" ? (cond.value as unknown[]) : [cond.value];
    for (const v of vals) if (!def.values.includes(v as string)) problems.push(`${path}: "${String(v)}" not a value of "${cond.fact}"`);
  }
  return problems;
}

function hasAssumption(c: Cond): boolean {
  if ("all" in c) return c.all.some(hasAssumption);
  if ("any" in c) return c.any.some(hasAssumption);
  if ("not" in c) return hasAssumption(c.not);
  if ("manualCheck" in c) return false;
  return !!c.assumeIfUnknown;
}

export function loadSchemes(
  facts: Record<string, FactDef>,
  { dataDir = DEFAULT_DATA_DIR, statuses = ["approved"] }: { dataDir?: string; statuses?: Scheme["status"][] } = {},
): Scheme[] {
  const dir = join(dataDir, "schemes");
  const schemes: Scheme[] = [];
  const problems: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const parsed = schemeSchema.safeParse(JSON.parse(readFileSync(join(dir, file), "utf8")));
    if (!parsed.success) {
      problems.push(`${file}: ${parsed.error.message}`);
      continue;
    }
    const scheme = parsed.data as Scheme;
    problems.push(...checkRules(scheme.rules, facts).map((p) => `${file}: ${p}`));
    if (statuses.includes(scheme.status)) schemes.push(scheme);
  }
  if (problems.length) throw new Error(`Invalid scheme data:\n${problems.join("\n")}`);
  return schemes;
}
