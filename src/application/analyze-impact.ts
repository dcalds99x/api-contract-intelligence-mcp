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
  const consumers = findEndpointConsumers({ projectRoot: root, ...(input.tsconfig ? { tsconfig: input.tsconfig } : {}) });
  const impacts = changes.filter((change) => change.breaking).map((change) => {
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
      "A análise de consumidores cobre chamadas diretas com método e path estáticos em clients criados por openapi-fetch.",
      "Wrappers, aliases complexos, caminhos dinâmicos e clientes HTTP diferentes não são rastreados.",
      "Uso confirmado de uma operação não confirma que o consumidor está incompatível; propriedades e fluxo de dados não são analisados.",
      "Mudanças sem método/path reconhecíveis permanecem no relatório, mas não podem ser correlacionadas a consumidores.",
    ],
  };
}

