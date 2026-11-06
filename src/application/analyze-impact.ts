import type { ImpactReport } from "../domain/types.js";
import { compareContracts } from "../infrastructure/openapi/oasdiff-adapter.js";
import { readSpec, resolveInsideRoot, resolveProjectRoot } from "../infrastructure/files.js";
import { findEndpointConsumers } from "../infrastructure/typescript/consumer-indexer.js";

export async function analyzeImpact(input: {
  projectRoot: string;
  baseSpec: string;
  headSpec: string;
  tsconfig?: string;
}): Promise<ImpactReport> {
  const root = await resolveProjectRoot(input.projectRoot);
  if (input.tsconfig) await resolveInsideRoot(root, input.tsconfig);
  const [base, head] = await Promise.all([
    readSpec(root, input.baseSpec),
    readSpec(root, input.headSpec),
  ]);
  const changes = await compareContracts(base, head);
  const consumers = await findEndpointConsumers({ projectRoot: root, ...(input.tsconfig ? { tsconfig: input.tsconfig } : {}) });
  const impacts = changes.map((change) => {
    if (!change.operation.method || !change.operation.path) {
      return { change, consumerImpact: "not_analyzed" as const, references: [] };
    }
    const references = consumers.filter((consumer) =>
      consumer.method === change.operation.method && consumer.path === change.operation.path);
    return {
      change,
      consumerImpact: references.length ? "confirmed_usage" as const : "not_found" as const,
      references,
    };
  });
  return {
    changes,
    consumers,
    impacts,
    unmatchedBreakingChanges: impacts.filter((impact) => impact.consumerImpact !== "confirmed_usage").map((impact) => impact.change),
    limitations: [
      "Consumer analysis covers direct calls with a static method and path on clients created by openapi-fetch.",
      "Wrappers, complex aliases, dynamic paths, and other HTTP clients are not tracked.",
      "Confirmed usage of an operation does not confirm that a consumer is incompatible; properties and data flow are not analyzed.",
      "Changes without a recognizable method/path remain in the report but cannot be correlated with consumers.",
    ],
  };
}

