import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { analyzeImpact } from "../application/analyze-impact.js";
import { readSpec, resolveInsideRoot, resolveProjectRoot } from "../infrastructure/files.js";
import { compareContracts } from "../infrastructure/openapi/oasdiff-adapter.js";
import { findEndpointConsumers } from "../infrastructure/typescript/consumer-indexer.js";

const pathInput = z.string().min(1).max(500).refine((value) => !value.includes("\0"), "Invalid path.");
const rootInput = z.string().min(1).max(500).default(".");
const methodInput = z.enum(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"]);

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Analysis failed: ${message}` }], isError: true };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "api-contract-intelligence", version: "0.1.0" });

  server.registerTool("analyze_contract_changes", {
    description: "Compares two local OpenAPI 3.0 specifications and lists breaking changes with ERR or WARN severity from oasdiff.",
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
    description: "Finds openapi-fetch calls with a static method and path in the project's TypeScript/TSX files.",
    inputSchema: { projectRoot: rootInput, method: methodInput, path: z.string().min(1).max(500), tsconfig: pathInput.optional() },
  }, async ({ projectRoot, method, path, tsconfig }) => {
    try {
      const root = await resolveProjectRoot(projectRoot);
      if (tsconfig) await resolveInsideRoot(root, tsconfig);
      return result({ consumers: await findEndpointConsumers({ projectRoot: root, ...(tsconfig ? { tsconfig } : {}) }, { method, path }) });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("analyze_change_impact", {
    description: "Correlates OpenAPI breaking changes with openapi-fetch consumers and states the analysis limitations.",
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
