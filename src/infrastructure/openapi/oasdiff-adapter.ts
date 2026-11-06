import { execFile } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";
import type { ContractChange, HttpMethod } from "../../domain/types.js";

const execFileAsync = promisify(execFile);
const METHODS = new Set<HttpMethod>(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"]);
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

function rejectExternalRefs(document: unknown): void {
  const pending: unknown[] = [document];
  const visited = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current && typeof current === "object") {
      if (visited.has(current)) continue;
      visited.add(current);
      for (const [key, value] of Object.entries(current)) {
        if (key === "$ref" && typeof value === "string" && !value.startsWith("#")) {
          throw new Error(`Referências externas não são aceitas no MVP: ${value}`);
        }
        pending.push(value);
      }
    }
  }
}

function parseContract(content: string, label: string): unknown {
  let document: unknown;
  try {
    document = YAML.parse(content);
  } catch (error) {
    throw new Error(`${label} não é um YAML/JSON válido: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!document || typeof document !== "object" || !("openapi" in document)) {
    throw new Error(`${label} não parece ser uma especificação OpenAPI.`);
  }
  const version = String((document as { openapi?: unknown }).openapi ?? "");
  if (!version.startsWith("3.0.")) throw new Error(`${label}: somente OpenAPI 3.0.x é suportado no MVP.`);
  rejectExternalRefs(document);
  return document;
}

function normalizeChanges(output: string): ContractChange[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("O oasdiff retornou uma saída JSON inválida.");
  }

  const changes = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { changes?: unknown }).changes)
      ? (parsed as { changes: unknown[] }).changes
      : null;
  if (!changes) throw new Error("Formato JSON de saída do oasdiff não reconhecido.");

  return changes.map((item, index) => {
    const change = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const properties = change;
    const methodRaw = String(change.operation ?? change.method ?? change.httpMethod ?? "").toUpperCase();
    const method = METHODS.has(methodRaw as HttpMethod) ? methodRaw as HttpMethod : null;
    const path = typeof change.path === "string" ? change.path : typeof change.endpoint === "string" ? change.endpoint : null;
    // Every item came from `oasdiff breaking`, so it is a breaking finding.
    const breaking = true;

    return {
      id: String(change.id ?? change.code ?? change.ruleId ?? `change-${index + 1}`),
      operation: { method, path },
      breaking,
      description: String(change.text ?? change.description ?? change.message ?? "Alteração identificada pelo oasdiff."),
      ...(typeof change.category === "string" ? { category: change.category } : {}),
      properties,
    };
  });
}

export async function compareContracts(base: { path: string; content: string }, head: { path: string; content: string }): Promise<ContractChange[]> {
  parseContract(base.content, "baseSpec");
  parseContract(head.content, "headSpec");

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("oasdiff", ["breaking", base.path, head.path, "--format", "json"], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    }));
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string; killed?: boolean; code?: string | number };
    if (failure.code === "ENOENT") {
      throw new Error("oasdiff não foi encontrado. Instale o binário oficial e disponibilize-o no PATH.");
    }
    if (failure.killed) throw new Error(`oasdiff excedeu o limite de ${TIMEOUT_MS / 1000} segundos.`);
    if (failure.stdout?.trim()) {
      stdout = failure.stdout;
    } else {
    const details = failure.stderr?.trim();
    throw new Error(details ? `oasdiff falhou: ${details}` : `oasdiff falhou: ${failure.message}`);
    }
  }

  return normalizeChanges(stdout);
}

