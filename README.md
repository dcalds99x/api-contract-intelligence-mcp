# API Contract Intelligence MCP

MCP local para relacionar alterações incompatíveis em contratos OpenAPI com chamadas TypeScript diretas feitas por `openapi-fetch`. O projeto está em v0.1: a análise aponta evidências verificáveis e declara limites; ela não afirma que encontrou todo consumidor nem que uma chamada encontrada está quebrada.

## Requisitos

- Node.js 20.11 ou superior
- `oasdiff` instalado e disponível no `PATH`

Instale o binário oficial do [oasdiff](https://github.com/oasdiff/oasdiff#installation) para o seu sistema. O servidor nunca baixa ou executa uma instalação sob demanda.

## Desenvolvimento

```bash
npm install
npm run dev
```

Para compilar: `npm run build`, depois execute `npm start`.

## Ferramentas MCP

- `analyze_contract_changes`: compara `baseSpec` e `headSpec` e normaliza alterações breaking.
- `find_endpoint_consumers`: encontra consumidores para um `method` + `path`.
- `analyze_change_impact`: combina as duas análises e inclui limitações explícitas.

Todas recebem `projectRoot` (padrão `.`); os caminhos dos contratos e o `tsconfig` são relativos a essa raiz. Por segurança, a raiz precisa ficar dentro do diretório de trabalho do processo, ou de `API_CONTRACT_ROOT` se definido. Caminhos absolutos, caminhos fora da raiz e `$ref` externos são rejeitados. Referências internas `#/...` são aceitas. Contratos acima de 5 MiB, projetos acima de 10.000 arquivos TS e comparações acima de 30 segundos são recusados/encerrados.

O indexador reconhece chamadas literais como `client.GET("/users/{id}", ...)` quando `client` é criado por `createClient` importado de `openapi-fetch`. Wrappers, URLs dinâmicas, uso de propriedade da resposta e outros clientes não são rastreados.

## Configuração MCP (exemplo)

No Codex, adicione um servidor stdio em Settings → MCP servers, ou inclua no `~/.codex/config.toml`:

```toml
[mcp_servers.api_contract_intelligence]
command = "node"
args = ["C:/caminho/para/Contract API - MCP/dist/index.js"]
cwd = "C:/caminho/para/Contract API - MCP"

[mcp_servers.api_contract_intelligence.env]
API_CONTRACT_ROOT = "C:/caminho/para/Contract API - MCP"
```

Compile o projeto com `npm run build` antes de conectar. Em desenvolvimento, use `npx tsx src/index.ts`. O protocolo usa stdio; logs da aplicação devem ir para stderr, nunca stdout.
