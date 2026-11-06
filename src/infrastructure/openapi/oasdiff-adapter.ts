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
          throw new Error(`External references are not supported in the MVP: ${value}`);
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
    throw new Error(`${label} is not valid YAML/JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!document || typeof document !== "object" || !("openapi" in document)) {
    throw new Error(`${label} does not appear to be an OpenAPI specification.`);
  }
  const version = String((document as { openapi?: unknown }).openapi ?? "");
  if (!version.startsWith("3.0.")) throw new Error(`${label}: only OpenAPI 3.0.x is supported in the MVP.`);
  rejectExternalRefs(document);
  return document;
}

function normalizeChanges(output: string): ContractChange[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("oasdiff returned invalid JSON output.");
  }

  const changes = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { changes?: unknown }).changes)
      ? (parsed as { changes: unknown[] }).changes
      : null;
  if (!changes) throw new Error("Unrecognized oasdiff JSON output format.");

  return changes.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid oasdiff change at index ${index}.`);
    }
    const change = item as Record<string, unknown>;
    const severity = change.level === 3 ? "ERR" : change.level === 2 ? "WARN" : null;
    if (!severity) throw new Error(`Unrecognized oasdiff severity at index ${index}.`);
    const properties = change;
    const methodRaw = String(change.operation ?? change.method ?? change.httpMethod ?? "").toUpperCase();
    const method = METHODS.has(methodRaw as HttpMethod) ? methodRaw as HttpMethod : null;
    const path = typeof change.path === "string" ? change.path : typeof change.endpoint === "string" ? change.endpoint : null;
    // ERR findings are definite breaks; WARN findings are potential breaks.
    const breaking = severity === "ERR";

    return {
      id: String(change.id ?? change.code ?? change.ruleId ?? `change-${index + 1}`),
      operation: { method, path },
      breaking,
      severity,
      description: String(change.text ?? change.description ?? change.message ?? "Change identified by oasdiff."),
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
      throw new Error("oasdiff was not found. Install the official binary and make it available on PATH.");
    }
    if (failure.killed) throw new Error(`oasdiff exceeded the ${TIMEOUT_MS / 1000}-second time limit.`);
    if (failure.stdout?.trim()) {
      stdout = failure.stdout;
    } else {
      const details = failure.stderr?.trim();
      throw new Error(details ? `oasdiff failed: ${details}` : `oasdiff failed: ${failure.message}`);
    }
  }

  return normalizeChanges(stdout);
}

