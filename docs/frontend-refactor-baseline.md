# Baseline e critérios da refatoração frontend

## Estado anterior

- `App.tsx`: 3.694 linhas na revisão imediatamente anterior à migração.
- CSS próprio: 77 linhas, com cores e tipografia literais.
- Uma única árvore de rotas carregava clientes, processos, timeline, riscos,
  workers, exportações e configurações.
- Build original documentado no plano: aproximadamente 348 KB de JavaScript
  bruto e 101 KB gzip, sem divisão por domínio.
- Não havia lint, testes frontend, teste de acessibilidade, E2E ou budget.

## Estado implementado

- `App.tsx` contém apenas composição e rotas lazy.
- Domínios independentes: overview, clients, processes, movements, risks,
  operations, reports e settings.
- Shell responsivo com sidebar/drawer, cliente global, busca, ajuda, tema e
  central persistente de tarefas.
- Processo em rota própria, ocorrências explícitas e timeline normalizada sobre
  o contrato atual do backend.
- Componentes e estados documentados em `frontend/docs/components.md`.

## Evidência automatizada

Executar em `frontend/`:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run bundle:check
npm run e2e
npm run audit
```

O E2E cobre a carga de todos os módulos, busca global por teclado, lista,
abertura do processo, timeline, separação entre ocorrências, origem
DJEN/DataJud, navegação por drawer e ausência de overflow horizontal no viewport
mobile. O mesmo teste mantém snapshots visuais desktop e mobile.

## Auditoria de dependências

O gate bloqueia vulnerabilidades críticas. Em 29/07/2026, o `npm audit` reporta
duas ocorrências altas no `react-router` 7.18.2 para processamento de ações RSC,
modo que não é habilitado nesta SPA. A versão atual foi preservada porque a
alternativa 7.11 reabre advisories de redirect/XSS aplicáveis ao roteador no
cliente. O alerta deve ser atualizado assim que houver release upstream fora da
faixa afetada.

## Dependências explícitas do backend

O frontend não simula persistência que o servidor ainda não oferece. O
construtor de relatórios informa que recortes avançados dependem do job de
exportação configurável. Histórico completo de logs/jobs e versionamento de
configurações também permanecem identificados na interface como contratos
pendentes, conforme a seção 14 do plano.
