import path from "node:path";
import { Project, SyntaxKind } from "ts-morph";
import type { ConsumerReference, HttpMethod } from "../../domain/types.js";

const MAX_FILES = 10_000;
const METHODS = new Set<HttpMethod>(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"]);

export type ConsumerScope = { projectRoot: string; tsconfig?: string };

function getStringArgument(node: import("ts-morph").CallExpression): string | undefined {
  const expression = node.getArguments()[0];
  if (!expression || !expression.isKind(SyntaxKind.StringLiteral)) return undefined;
  return expression.getLiteralValue();
}

export function findEndpointConsumers(scope: ConsumerScope, operation?: { method: HttpMethod; path: string }): ConsumerReference[] {
  const projectRoot = path.resolve(scope.projectRoot);
  const project = scope.tsconfig
    ? new Project({ tsConfigFilePath: path.resolve(projectRoot, scope.tsconfig), skipAddingFilesFromTsConfig: false })
    : new Project({ skipAddingFilesFromTsConfig: true });

  if (!scope.tsconfig) {
    project.addSourceFilesAtPaths([
      path.join(projectRoot, "**/*.ts"),
      path.join(projectRoot, "**/*.tsx"),
      `!${path.join(projectRoot, "**/node_modules/**")}`,
      `!${path.join(projectRoot, "**/dist/**")}`,
      `!${path.join(projectRoot, "**/*.d.ts")}`,
    ]);
  }

  const sourceFiles = project.getSourceFiles();
  if (sourceFiles.length > MAX_FILES) throw new Error(`Projeto excede o limite de ${MAX_FILES} arquivos TypeScript.`);

  const references: ConsumerReference[] = [];
  for (const sourceFile of sourceFiles) {
    const factoryNames = new Set<string>();
    for (const declaration of sourceFile.getImportDeclarations()) {
      if (declaration.getModuleSpecifierValue() !== "openapi-fetch") continue;
      const named = declaration.getNamedImports().find((item) => item.getName() === "createClient");
      if (named) factoryNames.add(named.getAliasNode()?.getText() ?? named.getName());
    }

    const clientNames = new Set<string>();
    for (const variable of sourceFile.getVariableDeclarations()) {
      const initializer = variable.getInitializer();
      if (!initializer?.isKind(SyntaxKind.CallExpression)) continue;
      const expression = initializer.getExpression();
      if (expression.isKind(SyntaxKind.Identifier) && factoryNames.has(expression.getText())) {
        clientNames.add(variable.getName());
      }
    }

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (!expression.isKind(SyntaxKind.PropertyAccessExpression)) continue;
      const clientName = expression.getExpression().getText();
      const method = expression.getName().toUpperCase();
      if (!clientNames.has(clientName) || !METHODS.has(method as HttpMethod)) continue;

      const apiPath = getStringArgument(call);
      if (!apiPath || !apiPath.startsWith("/")) continue;
      const reference = { method: method as HttpMethod, path: apiPath };
      if (operation && (operation.method !== reference.method || operation.path !== reference.path)) continue;

      references.push({
        ...reference,
        file: path.relative(projectRoot, sourceFile.getFilePath()).split(path.sep).join("/"),
        line: call.getStartLineNumber(),
        confidence: "confirmed_usage",
      });
    }
  }
  return references;
}

