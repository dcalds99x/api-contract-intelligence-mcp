import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_SPEC_BYTES = 5 * 1024 * 1024;

export async function resolveInsideRoot(rootInput: string, relativeInput: string): Promise<string> {
  if (path.isAbsolute(relativeInput)) {
    throw new Error("Use caminhos relativos à raiz do projeto.");
  }

  const root = await realpath(rootInput);
  const candidate = path.resolve(root, relativeInput);
  const resolved = await realpath(candidate);
  const relative = path.relative(root, resolved);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`O caminho precisa permanecer dentro da raiz do projeto: ${relativeInput}`);
  }

  return resolved;
}

export async function resolveProjectRoot(relativeRoot: string): Promise<string> {
  const allowedRoot = process.env.API_CONTRACT_ROOT ?? process.cwd();
  return resolveInsideRoot(allowedRoot, relativeRoot);
}

export async function readSpec(root: string, relativePath: string): Promise<{ path: string; content: string }> {
  const filePath = await resolveInsideRoot(root, relativePath);
  const metadata = await stat(filePath);
  if (!metadata.isFile()) throw new Error(`O contrato não é um arquivo: ${relativePath}`);
  if (metadata.size > MAX_SPEC_BYTES) throw new Error(`O contrato excede o limite de ${MAX_SPEC_BYTES} bytes.`);
  return { path: filePath, content: await readFile(filePath, "utf8") };
}

