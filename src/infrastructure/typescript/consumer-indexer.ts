import path from "node:path";
import { realpath } from "node:fs/promises";
import ts from "typescript";
import { Project, SyntaxKind } from "ts-morph";
import type { ConsumerReference, HttpMethod } from "../../domain/types.js";

const MAX_FILES = 10_000;
const METHODS = new Set<HttpMethod>(["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"]);
const EXCLUDED_DIRECTORIES = ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/coverage/**"];

export type ConsumerScope = { projectRoot: string; tsconfig?: string };

function getStringArgument(node: import("ts-morph").CallExpression): string | undefined {
  const expression = node.getArguments()[0];
  if (!expression || !expression.isKind(SyntaxKind.StringLiteral)) return undefined;
  return expression.getLiteralValue();
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function getConfiguredSourceFiles(projectRoot: string, tsconfig: string): string[] {
  const configPath = path.resolve(projectRoot, tsconfig);
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  if (parsedConfig.errors.length) {
    throw new Error(ts.flattenDiagnosticMessageText(parsedConfig.errors[0]!.messageText, "\n"));
  }

  return parsedConfig.fileNames.filter((filePath) => /\.tsx?$/i.test(filePath) && !/\.d\.ts$/i.test(filePath));
}

export async function findEndpointConsumers(scope: ConsumerScope, operation?: { method: HttpMethod; path: string }): Promise<ConsumerReference[]> {
  const projectRoot = path.resolve(scope.projectRoot);
  const sourcePaths = scope.tsconfig
    ? getConfiguredSourceFiles(projectRoot, scope.tsconfig)
    : ts.sys.readDirectory(projectRoot, [".ts", ".tsx"], EXCLUDED_DIRECTORIES, ["**/*.ts", "**/*.tsx"])
      .filter((filePath) => !/\.d\.ts$/i.test(filePath));

  if (sourcePaths.length > MAX_FILES) throw new Error(`Project exceeds the limit of ${MAX_FILES} TypeScript files.`);

  const resolvedPaths = await Promise.all(sourcePaths.map((filePath) => realpath(filePath)));
  if (resolvedPaths.some((filePath) => !isInsideRoot(projectRoot, filePath))) {
    throw new Error("Source files must stay within the project root.");
  }

  const project = scope.tsconfig
    ? new Project({ tsConfigFilePath: path.resolve(projectRoot, scope.tsconfig), skipAddingFilesFromTsConfig: true })
    : new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(resolvedPaths);
  const sourceFiles = project.getSourceFiles();

  const references: ConsumerReference[] = [];
  for (const sourceFile of sourceFiles) {
    const factoryNames = new Set<string>();
    for (const declaration of sourceFile.getImportDeclarations()) {
      if (declaration.getModuleSpecifierValue() !== "openapi-fetch") continue;
      const defaultImport = declaration.getDefaultImport();
      if (defaultImport) factoryNames.add(defaultImport.getText());
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

