import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { analyzeImpact } from "../application/analyze-impact.js";
import { readSpec, resolveInsideRoot, resolveProjectRoot } from "../infrastructure/files.js";
import { compareContracts } from "../infrastructure/openapi/oasdiff-adapter.js";
import { findEndpointConsumers } from "../infrastructure/typescript/consumer-indexer.js";

const pathInput = z.string().min(1).max(500).refine((value) => !value.includes("\0"), "Caminho inválido.");
const rootInput = z.string().min(1).max(500).default(".");
const methodInput = z.enum(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"]);

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Análise não concluída: ${message}` }], isError: true };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "api-contract-intelligence", version: "0.1.0" });

  server.registerTool("analyze_contract_changes", {
    description: "Compara duas especificações OpenAPI 3.0 locais e lista alterações breaking identificadas pelo oasdiff.",
    inputSchema: { projectRoot: rootInput, baseSpec: pathInput, headSpec: pathInput },
  }, async ({ projectRoot, baseSpec, headSpec }) => {
    try {
      const root = await resolveProjectRoot(projectRoot);
      const [base, head] = await Promise.all([readSpec(root, baseSpec), readSpec(root, headSpec)]);
      return result({ changes: await compareContracts(base, head) });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("find_endpoint_consumers", {
    description: "Encontra chamadas openapi-fetch com método e path estáticos em arquivos TypeScript/TSX do projeto.",
    inputSchema: { projectRoot: rootInput, method: methodInput, path: z.string().min(1).max(500), tsconfig: pathInput.optional() },
  }, async ({ projectRoot, method, path, tsconfig }) => {
    try {
      const root = await resolveProjectRoot(projectRoot);
      if (tsconfig) await resolveInsideRoot(root, tsconfig);
      return result({ consumers: findEndpointConsumers({ projectRoot: root, ...(tsconfig ? { tsconfig } : {}) }, { method, path }) });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("analyze_change_impact", {
    description: "Correlaciona mudanças breaking do OpenAPI com consumidores openapi-fetch e explicita os limites da análise.",
    inputSchema: { projectRoot: rootInput, baseSpec: pathInput, headSpec: pathInput, tsconfig: pathInput.optional() },
  }, async ({ projectRoot, baseSpec, headSpec, tsconfig }) => {
    try {
      return result(await analyzeImpact({ projectRoot, baseSpec, headSpec, ...(tsconfig ? { tsconfig } : {}) }));
    } catch (error) {
      return failure(error);
    }
  });

  return server;
}
