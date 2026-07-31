# Validação do plano de refatoração frontend

Esta matriz registra a entrega do plano
`docs/plano-refatoracao-frontend-juds.md` e separa o que foi implementado no
frontend dos contratos que o próprio plano atribui ao backend.

## Entregas

| Frente         | Evidência implementada                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Arquitetura    | Rotas lazy e páginas por domínio; `App.tsx` restrito à composição; providers globais e boundaries por aplicação e rota           |
| Design system  | Tokens semânticos claro/escuro/sistema, Tailwind mapeado, primitivas acessíveis e catálogo em `frontend/docs/components.md`      |
| Shell          | Sidebar recolhível, drawer mobile, cliente na URL, busca global com `Ctrl+K`, histórico local, ajuda, tema e central de tarefas  |
| Clientes       | Busca/ordenação, cartões/tabela, cadastro em dialog, edição, exclusão confirmada, pesquisa e detalhe próprio                     |
| Processos      | Busca com debounce, URL, filtros avançados/chips, visualizações, colunas/densidade/ordenação, paginação, prefetch e cards mobile |
| Detalhe        | Rota e abas próprias, cabeçalho jurídico, seleção explícita de ocorrência, alertas de fonte e atualização com escopo             |
| Timeline       | DJEN/DataJud unificados, agrupamento, origem/grau/órgão/tipo/data/risco, busca, filtros, ordem, densidade e drawer técnico       |
| Riscos         | Métricas, filtros, CRUD seguro, simulador, impacto, reprocessamento separado, tarefas e histórico local                          |
| Operações      | KPIs, polling adaptativo, controle manual, start/stop confirmados, detalhe, estado/log sanitizado e integridade                  |
| Relatórios     | Construtor, estimativa, seleção de processos/campos/período/formato/ordem, download, repetição e histórico local                 |
| Configurações  | Subrotas, ordem explícita com teclado/botões, conflitos, simulador, impacto, padrões e restauração confirmada                    |
| Qualidade      | ESLint, Prettier, Vitest, RTL, MSW, axe, Playwright desktop/mobile, snapshots, cobertura mínima e budget no CI                   |
| Desempenho     | Divisão por rota, prefetch, cancelamento por `AbortSignal`, debounce, cache por recurso, polling por visibilidade e budget       |
| Acessibilidade | Skip link, landmarks, nomes de ícones, foco Radix, `aria-live`, reduced motion, tabela semântica e axe                           |

## Contratos de backend preservados

O frontend não simula persistência operacional inexistente. Permanecem
explicitamente identificados na interface:

- histórico durável e paginação global de jobs/logs;
- exportação assíncrona com todos os recortes do construtor;
- versionamento e restauração histórica de configurações;
- operações em lote de risco/processo;
- eventos do servidor para substituir polling.

Até esses contratos existirem, histórico de preferências, configurações de
relatório e auditoria visual é identificado como local ao navegador. O contrato
normalizado já existente de processo, fontes e timeline é validado em runtime
com Zod e coberto por testes.

## Gates executáveis

Em `frontend/`:

```bash
npm run ci
npm run e2e
```

Em `backend/`:

```bash
.venv/bin/pytest
```

O E2E percorre os módulos principais e cobre cadastro de cliente, atualização
de processo, criação de regra de risco, exportação, deep link da timeline,
origem/ocorrência, busca global, navegação mobile e regressão visual.
