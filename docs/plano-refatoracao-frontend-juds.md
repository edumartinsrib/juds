# Plano de refatoração e evolução do frontend do JUDS

## 1. Resumo executivo

O frontend atual é funcional e compila para produção, mas cresceu como uma aplicação monolítica: quase toda a navegação, regras de tela, consultas, mutações, formulários, tabelas, modais e componentes estão concentrados em um único arquivo de 3.553 linhas. A camada visual possui somente 77 linhas de estilos próprios e poucos componentes reutilizáveis. Isso torna qualquer evolução visual ou funcional mais lenta, aumenta a chance de regressões e produz experiências inconsistentes entre os módulos.

A recomendação é uma **refatoração incremental**, preservando React, TypeScript, Vite, Tailwind, TanStack Query e TanStack Table. O trabalho deve começar pela fundação visual e arquitetural e, em seguida, modernizar os fluxos que entregam mais valor ao usuário: **processos, detalhe do processo e movimentações**.

O produto-alvo deve se comportar como um workspace jurídico moderno: informativo, rápido, confiável, responsivo e com contexto sempre visível. A interface deve deixar evidente:

- qual cliente e processo estão ativos;
- de onde veio cada movimentação;
- qual instância, grau ou fonte está sendo exibida;
- quando uma consulta está em andamento, concluiu ou falhou;
- quais filtros estão aplicados;
- quais ações alteram dados ou disparam reprocessamentos.

### Resultado esperado

Ao final do plano, o JUDS terá:

- arquitetura frontend modular por domínio;
- design system consistente e acessível;
- navegação responsiva com contexto persistido na URL;
- dashboard operacional;
- pesquisa e filtros eficientes;
- página própria de processo com timeline unificada;
- estados de carregamento, sucesso, erro e vazio padronizados;
- ferramentas administrativas mais seguras;
- testes automatizados e controles de qualidade no CI;
- métricas de desempenho e usabilidade;
- base pronta para novas funcionalidades sem voltar a concentrar tudo em `App.tsx`.

---

## 2. Escopo analisado

Plano baseado na branch `main`, commit [`84bc1e0`](https://github.com/edumartinsrib/juds/commit/84bc1e06f47f1b33a9bb7736ebb5d5e98c5eb275).

### Evidências do estado atual

| Evidência | Situação atual | Consequência |
|---|---:|---|
| [`frontend/src/App.tsx`](https://github.com/edumartinsrib/juds/blob/84bc1e06f47f1b33a9bb7736ebb5d5e98c5eb275/frontend/src/App.tsx) | 3.553 linhas | Alto acoplamento entre páginas, dados e UI |
| [`frontend/src/styles.css`](https://github.com/edumartinsrib/juds/blob/84bc1e06f47f1b33a9bb7736ebb5d5e98c5eb275/frontend/src/styles.css) | 77 linhas | Linguagem visual pequena e pouco sistematizada |
| [`frontend/src/main.tsx`](https://github.com/edumartinsrib/juds/blob/84bc1e06f47f1b33a9bb7736ebb5d5e98c5eb275/frontend/src/main.tsx) | Providers mínimos | Falta tratamento global de erros, notificações e configuração de consultas |
| [`frontend/package.json`](https://github.com/edumartinsrib/juds/blob/84bc1e06f47f1b33a9bb7736ebb5d5e98c5eb275/frontend/package.json) | Sem lint, testes ou catálogo de componentes | Regressões visuais e funcionais são detectadas tarde |
| Lista de processos | Tabela com largura mínima de 1.280 px | Experiência fraca em telas menores |
| Seleção de cliente/processo | Estado local | Atualização da página perde contexto; não há deep link |
| Ações destrutivas | `window.confirm` e formulários inline | Experiência inconsistente e pouco controlada |
| Workers | Atualização fixa a cada 3 segundos | Pouco controle e pouca visibilidade operacional |

### Baseline técnico

- TypeScript está com `strict: true`.
- O build de produção foi validado com sucesso.
- Bundle atual: aproximadamente 348 KB de JavaScript bruto e 101 KB gzip.
- A refatoração pode ser entregue gradualmente, mantendo o sistema utilizável durante todo o trabalho.

---

## 3. Problemas a resolver

### 3.1 Arquitetura

- Todas as funcionalidades estão concentradas em poucos arquivos.
- Componentes visuais, regras de negócio e integração com API não têm limites claros.
- Consultas e invalidações do TanStack Query estão repetidas nas páginas.
- Tipos da API são mantidos manualmente e não possuem validação em runtime.
- Seleções, abas, paginação e filtros importantes não estão representados na URL.
- Não há Error Boundary, tratamento global de erros ou estratégia uniforme para retry e cache.
- Não há lazy loading por rota.

### 3.2 Design e consistência

- A paleta, tipografia, espaçamento, bordas, elevação e estados interativos são muito limitados.
- A interface é predominantemente uma coleção de painéis e formulários, sem hierarquia visual forte.
- Ações primárias e secundárias nem sempre têm distinção suficiente.
- Os módulos usam padrões diferentes para criar, editar, excluir e atualizar.
- A interface só possui tema claro e não usa tokens semânticos que permitam evolução.
- Textos da interface estão sem acentuação em vários pontos.

### 3.3 Usabilidade

- O menu superior com sete opções perde eficiência em telas pequenas.
- O contexto de cliente e processo não acompanha o usuário entre as telas.
- Formulários de criação ocupam espaço permanentemente, mesmo quando não estão em uso.
- Processos exigem muitos filtros expostos e um botão adicional para aplicá-los.
- Tabelas não oferecem ordenação, controle de colunas, densidade ou visualizações salvas.
- O usuário não recebe feedback uniforme de carregamento, atualização, sucesso e erro.
- O detalhe do processo fica misturado à lista, em vez de funcionar como uma área própria.
- O status das tarefas em segundo plano fica restrito a páginas específicas.

### 3.4 Movimentações e coerência jurídica

- Movimentos DJEN e dados complementares do DataJud aparecem em blocos distintos.
- Fontes podem usar cronologias e campos diferentes, sem explicação visual suficiente.
- Não existe uma timeline única com fonte, grau, órgão julgador e origem claramente identificados.
- A seleção da instância ou ocorrência processual não está explícita.
- O fluxo atual favorece a impressão de divergência entre processo e movimentos.
- O frontend precisa acompanhar a correção de modelo e dados proposta na análise anterior.

### 3.5 Acessibilidade e responsividade

- Botões somente com ícone dependem de `title` e nem sempre possuem nome acessível.
- O modal atual não implementa integralmente foco inicial, contenção de foco e devolução do foco.
- Falta link para pular ao conteúdo e regiões de anúncio para mudanças assíncronas.
- Estados de foco, contraste e navegação por teclado precisam de auditoria.
- A tabela larga força rolagem horizontal.
- Os alvos de toque e a organização de ações no mobile não são consistentes.

### 3.6 Qualidade

- Não há testes unitários, de componentes ou ponta a ponta.
- Não há lint e formatação padronizados.
- Não há testes automatizados de acessibilidade.
- Não há catálogo isolado dos componentes visuais.
- Não existem budgets de bundle nem verificação de regressão de desempenho.

---

## 4. Direção de produto e experiência

### 4.1 Princípios

1. **Contexto antes da ação:** cliente, processo, fonte e instância devem estar visíveis antes de qualquer atualização ou consulta.
2. **Densidade com legibilidade:** o usuário jurídico precisa ver bastante informação, mas com hierarquia, agrupamento e espaço adequados.
3. **Ação progressiva:** formulários e filtros avançados aparecem sob demanda, não ocupam a tela permanentemente.
4. **Feedback contínuo:** toda ação assíncrona deve mostrar início, progresso, conclusão e erro.
5. **Estado compartilhável:** páginas, filtros, abas e seleções relevantes devem sobreviver ao refresh e poder ser compartilhados por URL.
6. **Fonte explícita:** nenhum evento jurídico deve aparecer sem origem e contexto identificáveis.
7. **Segurança operacional:** excluir, reprocessar ou iniciar rotinas exige confirmação contextual e consequência visível.
8. **Movimento com propósito:** animações devem reforçar mudança de estado, respeitando preferência por movimento reduzido.

### 4.2 Linguagem visual proposta

| Elemento | Direção |
|---|---|
| Personalidade | Profissional, confiável, moderna e sóbria |
| Cores | Base neutra em cinza-azulado; azul como marca; verde, âmbar e vermelho apenas para semântica |
| Tipografia | Escala clara para título, seção, corpo, metadado e código/número processual |
| Espaçamento | Escala consistente baseada em múltiplos de 4/8 px |
| Bordas | Raios pequenos e médios; cartões sem excesso de contorno |
| Elevação | Sombras discretas para navegação, drawers, menus e modais |
| Ícones | Lucide, sempre acompanhados de rótulo ou nome acessível |
| Movimento | Transições curtas em drawers, filtros, feedback e troca de estado |
| Densidade | Modos confortável e compacto para tabelas e timelines |
| Tema | Tokens preparados para tema escuro; implementação pode ficar para uma fase posterior |

---

## 5. Nova arquitetura de informação

### 5.1 Navegação principal

| Área | Conteúdo |
|---|---|
| Visão geral | Dashboard, alertas e atividades recentes |
| Clientes | Lista, cadastro, detalhe e histórico de consultas |
| Processos | Pesquisa, filtros, visualizações e detalhe do processo |
| Riscos | Regras, simulação, impacto e reprocessamentos |
| Operações | Workers, filas, execuções, falhas e logs |
| Relatórios | Configuração, geração e histórico de exportações |
| Configurações | Fases, padrões e parâmetros do sistema |

### 5.2 App shell

- Sidebar recolhível no desktop.
- Drawer de navegação no mobile.
- Topbar com:
  - seletor global de cliente;
  - busca global por número, parte ou cliente;
  - central de tarefas e notificações;
  - ajuda contextual;
  - preferências do usuário.
- Cabeçalho de página com título, descrição, breadcrumbs e ação primária.
- Área de conteúdo fluida, sem limitar tabelas operacionais a um contêiner estreito.
- Barra de ações fixa no mobile quando houver ação primária importante.

### 5.3 Rotas propostas

```text
/
/clientes
/clientes/novo
/clientes/:clientId
/clientes/:clientId/processos
/processos
/processos/:processId/visao-geral
/processos/:processId/movimentacoes
/processos/:processId/partes
/processos/:processId/riscos
/processos/:processId/fontes
/riscos
/operacoes
/operacoes/:workerId
/relatorios
/configuracoes/fases
/configuracoes/padroes
```

Filtros, ordenação, página, aba, densidade e colunas visíveis devem usar query parameters quando fizer sentido.

---

## 6. Design system e componentes compartilhados

### 6.1 Fundação

- Definir tokens CSS semânticos para cor, tipografia, espaçamento, raio, sombra e movimento.
- Manter Tailwind como motor de estilos e mapear tokens no `tailwind.config`.
- Evitar cores literais dentro das páginas.
- Adotar primitivas acessíveis para Dialog, Drawer, Dropdown, Popover, Tooltip, Tabs, Toast e Combobox.
- Criar documentação e exemplos dos componentes. Storybook é recomendado quando a biblioteca começar a crescer.

### 6.2 Componentes essenciais

| Grupo | Componentes |
|---|---|
| Ações | Button, IconButton, ButtonGroup, DropdownMenu, ConfirmDialog |
| Formulários | Input, Textarea, Select, Combobox, DatePicker, Checkbox, Switch, Field, FormError |
| Feedback | Toast, Alert, Progress, Spinner, Skeleton, EmptyState, ErrorState |
| Dados | Badge, StatusChip, StatCard, DataTable, Pagination, DescriptionList |
| Navegação | Sidebar, Breadcrumbs, Tabs, PageHeader, CommandMenu |
| Sobreposição | Dialog, Drawer, Popover, Tooltip |
| Domínio jurídico | ProcessNumber, RiskBadge, PhaseBadge, SourceBadge, DegreeBadge, MovementCard, ProcessHeader |
| Operações | JobStatus, WorkerCard, LogViewer, ActivityFeed |

### 6.3 Estados obrigatórios

Todo componente de consulta ou ação deve prever:

- carregamento inicial;
- atualização em segundo plano;
- lista vazia;
- erro recuperável;
- erro impeditivo;
- sucesso;
- bloqueado/desabilitado;
- acesso somente leitura;
- conteúdo truncado com expansão;
- visualização mobile.

---

## 7. Arquitetura técnica proposta

### 7.1 Organização por domínio

```text
src/
  app/
    layout/
    providers/
    router/
  components/
    ui/
    layout/
    feedback/
  features/
    clients/
      api/
      components/
      hooks/
      pages/
      schemas/
    processes/
    movements/
    risks/
    workers/
    reports/
    settings/
  lib/
    api/
    query/
    formatters/
    validation/
  styles/
    tokens.css
    globals.css
  test/
```

### 7.2 Regras arquiteturais

- Página orquestra; componente apresenta; hook trata estado; módulo de API integra.
- Componentes de domínio não devem importar páginas.
- Chaves do TanStack Query devem ser geradas por factories por domínio.
- Mutações devem compartilhar política de invalidação e feedback.
- Formatação de data, número processual, tribunal e grau deve ficar centralizada.
- Tipos de transporte da API não devem ser usados diretamente em toda a interface; mapear para view models quando necessário.
- Introduzir validação de respostas em runtime. Se o backend expuser OpenAPI confiável, gerar o cliente e tipos.
- Criar um Error Boundary por aplicação e boundaries menores em rotas críticas.
- Carregar módulos administrativos por lazy route.

### 7.3 Estado e URL

- Manter no estado local apenas interações transitórias, como modal aberto e texto ainda não aplicado.
- Persistir cliente, processo, página, filtros, ordenação e abas na rota.
- Preservar filtros ao abrir um processo e retornar à lista.
- Implementar prefetch do detalhe ao focar ou apontar para uma linha.
- Definir `staleTime`, retry e refetch conforme natureza de cada dado.
- Cancelar pesquisas antigas ao alterar filtros.

### 7.4 Integração e contratos

- Padronizar envelope de erro com código, mensagem amigável e detalhes opcionais.
- Diferenciar ausência de dados, fonte indisponível e falha de processamento.
- Não exibir payload técnico bruto ao usuário final.
- Normalizar datas e fuso horário em um único ponto.
- Garantir identificadores estáveis para cliente, processo, ocorrência processual e movimento.

---

## 8. Melhorias por módulo

## 8.1 Dashboard

Criar uma página inicial operacional com:

- quantidade de clientes e processos acompanhados;
- processos por risco e fase;
- novas movimentações no período;
- consultas em execução, concluídas e com falha;
- fontes desatualizadas;
- atividades recentes;
- atalhos para cadastrar cliente, pesquisar processo e iniciar atualização;
- lista priorizada de itens que exigem ação.

Evitar gráficos decorativos. Cada indicador deve abrir a lista correspondente já filtrada.

## 8.2 Clientes

- Trocar o formulário permanente por botão “Novo cliente” abrindo drawer ou página dedicada.
- Adicionar busca por nome/documento e ordenação.
- Oferecer visualização em tabela e cartões, conforme largura e preferência.
- Tornar o cartão/linha clicável.
- Usar menu de ações para editar, pesquisar processos e excluir.
- Exibir último status de consulta, última atualização e quantidade de processos.
- Criar página de detalhe do cliente com:
  - resumo;
  - processos;
  - histórico de consultas;
  - erros recentes;
  - atividades.
- Substituir `window.confirm` por confirmação acessível com nome do cliente e consequência.
- Exibir feedback imediato após criar, editar ou excluir.

## 8.3 Processos

- Criar busca rápida por número e partes.
- Colocar filtros avançados em painel lateral, mantendo filtros principais na barra.
- Mostrar filtros aplicados como chips removíveis.
- Aplicar filtros simples automaticamente com debounce; manter botão explícito para combinações avançadas se necessário.
- Persistir filtros, página e ordenação na URL.
- Permitir ordenar colunas.
- Adicionar controle de colunas, densidade e tamanho da página.
- Oferecer visualizações salvas, como “Alto risco”, “Sem atualização” e “Novos movimentos”.
- Fixar colunas essenciais: processo, fase, risco e última movimentação.
- Tornar a linha clicável e manter ações secundárias em menu.
- Usar cartões responsivos no mobile em vez de forçar tabela de 1.280 px.
- Exibir skeleton na primeira carga e indicador discreto em atualizações.
- Adicionar estado vazio contextual, com ação para remover filtros.
- Preparar seleção em lote para exportar ou atualizar processos, somente após regras de segurança e backend suportarem a operação.

## 8.4 Detalhe do processo

Transformar o detalhe em rota própria, com cabeçalho fixo contendo:

- número do processo;
- tribunal, grau, classe e órgão julgador;
- partes principais;
- fase e risco;
- última atualização;
- seletor da ocorrência/instância quando houver mais de uma;
- ações “Atualizar”, “Exportar” e “Mais”.

Separar o conteúdo em abas:

- Visão geral;
- Movimentações;
- Partes;
- Riscos;
- Fontes e sincronização.

Adicionar alertas visuais quando:

- fontes divergem;
- há mais de uma ocorrência processual;
- a consulta está desatualizada;
- uma fonte falhou;
- a classificação de fase é incerta;
- o processo está sendo atualizado.

## 8.5 Movimentações

Esta é a prioridade funcional mais alta e deve acompanhar a correção do modelo de dados.

### Timeline unificada

- Unir eventos DJEN, DataJud e futuras fontes em uma única sequência normalizada.
- Ordenar por data decrescente por padrão.
- Identificar em cada item:
  - fonte;
  - data;
  - tribunal;
  - grau/instância;
  - órgão;
  - tipo/código;
  - texto;
  - vínculo com publicação, quando houver;
  - risco ou regra aplicada.
- Agrupar por dia ou mês para facilitar leitura.
- Permitir expandir texto longo sem perder posição.
- Disponibilizar busca no conteúdo e filtros por fonte, tipo, período, grau e risco.
- Permitir alternar densidade e recolher grupos.
- Oferecer “Ir para a movimentação mais recente”.
- Explicar, por tooltip ou ajuda contextual, as diferenças entre fonte oficial, publicação e enriquecimento.

### Tratamento de divergências

- Nunca misturar movimentos de ocorrências diferentes sem identificação.
- Exibir seletor de ocorrência/instância antes da timeline quando houver ambiguidade.
- Mostrar um banner quando as fontes discordarem na identificação do processo.
- Permitir consultar o detalhe técnico da origem em drawer, sem poluir a timeline.
- Diferenciar “sem movimentos”, “fonte não consultada”, “consulta em andamento” e “consulta falhou”.
- Manter a fonte original e o evento normalizado visíveis para auditoria.

### Atualização

- Mover intervalo de datas e opções avançadas para um dialog/drawer.
- Mostrar escopo antes de confirmar: processo, ocorrência, fontes e período.
- Criar tarefa em segundo plano com progresso na central global.
- Atualizar somente os blocos afetados após concluir.
- Exibir resumo da atualização: novos eventos, duplicados ignorados, conflitos e falhas.

## 8.6 Riscos

- Criar cabeçalho com métricas: regras ativas, processos afetados e pendências de reprocessamento.
- Substituir cartões de edição inline por tabela de regras e editor em drawer/página.
- Adicionar busca, filtro por status/categoria e ordenação por prioridade.
- Exibir termos como chips, com suporte a inclusão e exclusão.
- Criar simulador: informar texto ou selecionar processo e visualizar quais regras seriam acionadas.
- Mostrar estimativa de impacto antes de salvar uma regra.
- Separar salvar regra de reprocessar toda a base.
- Tornar reprocessamento uma ação explícita, com escopo e confirmação.
- Permitir ativar/desativar em lote quando o backend oferecer operação segura.
- Registrar histórico de alteração e de reprocessamento.

## 8.7 Operações e workers

- Transformar workers em painel operacional.
- Mostrar KPIs de ativos, em fila, concluídos e com erro.
- Exibir tipo, cliente, início, duração, progresso e última mensagem.
- Permitir ligar/desligar atualização automática.
- Reduzir polling quando a aba estiver em background.
- Usar atualização adaptativa ou eventos do servidor quando disponível.
- Criar drawer de detalhe com logs, eventos e payload sanitizado.
- Manter histórico de execuções e filtros.
- Exigir confirmação para interromper uma tarefa.
- Oferecer retomada/reexecução somente quando semanticamente segura.

## 8.8 Relatórios e exportações

- Criar construtor de relatório com:
  - cliente;
  - processos;
  - período;
  - filtros;
  - campos;
  - formato;
  - ordenação.
- Mostrar estimativa do conteúdo antes de gerar.
- Gerar arquivos grandes em tarefa assíncrona.
- Exibir progresso, histórico, validade e falhas.
- Permitir repetir uma configuração anterior.
- Usar os filtros atuais da lista como ponto de partida.

## 8.9 Configurações

- Transformar abas locais em subrotas.
- Criar editor visual de fases, com ordem explícita.
- Permitir reordenar fases com teclado e controles, além de drag and drop.
- Exibir termos associados como chips.
- Detectar termos duplicados ou conflitos entre fases.
- Criar simulador para testar a fase calculada a partir de uma movimentação.
- Mostrar impacto estimado antes de salvar alterações.
- Separar padrões globais de exceções específicas.
- Manter histórico e possibilidade de restaurar configuração anterior quando o backend suportar versionamento.

---

## 9. Funcionalidades transversais

### 9.1 Busca global

- Buscar cliente, número de processo e partes.
- Navegação por teclado.
- Resultados agrupados por tipo.
- Histórico recente local.
- Atalhos para ações frequentes.
- Não enviar dados pessoais para telemetria.

### 9.2 Central de tarefas e notificações

- Reunir pesquisas, atualizações, reprocessamentos e exportações.
- Mostrar progresso e conclusão sem prender o usuário à página que iniciou a ação.
- Usar toasts para feedback breve e central persistente para histórico.
- Incluir link direto para o resultado ou erro.

### 9.3 Feedback e prevenção de erro

- Mensagens com orientação sobre como corrigir.
- Confirmações que descrevem escopo e consequência.
- Prevenção de duplo envio.
- Indicador de alterações não salvas.
- Recuperação de formulário quando viável.
- Ações otimistas somente em mudanças simples e reversíveis.

### 9.4 Português e conteúdo

- Corrigir acentuação e padronizar termos.
- Criar glossário de termos jurídicos e operacionais.
- Centralizar textos reutilizados.
- Preparar estrutura para internacionalização, sem exigir tradução imediata.
- Usar datas e números de acordo com `pt-BR`.

---

## 10. Acessibilidade

Meta: conformidade com WCAG 2.2 nível AA nos fluxos principais.

- Navegação integral por teclado.
- Link “Pular para o conteúdo”.
- Ordem de foco previsível.
- Foco inicial, contenção e restauração em dialogs/drawers.
- `aria-label` em ações somente com ícone.
- Regiões `aria-live` para progresso, erro e conclusão.
- Contraste adequado em texto, bordas e estados.
- Estados não dependentes apenas de cor.
- Alvos de toque com tamanho confortável.
- Títulos e landmarks semânticos.
- Tabelas com cabeçalhos, ordenação e descrições acessíveis.
- Preferência `prefers-reduced-motion`.
- Testes automatizados com axe e validação manual com teclado e leitor de tela.

---

## 11. Responsividade

### Desktop

- Sidebar recolhível.
- Tabelas densas e painel de filtros.
- Detalhe com áreas lado a lado somente quando houver espaço.

### Tablet

- Sidebar em drawer.
- Filtros em painel lateral.
- Tabelas com colunas prioritárias e ações agrupadas.

### Mobile

- Cards de processo e cliente.
- Cabeçalho compacto.
- Ações primárias fixas no rodapé quando necessário.
- Drawers em tela cheia.
- Formulários em uma coluna.
- Timeline com metadados progressivamente revelados.
- Nenhum fluxo principal dependente de rolagem horizontal.

---

## 12. Desempenho

- Lazy loading por rota e feature administrativa.
- Divisão do bundle por domínio.
- Prefetch do detalhe de processos mais prováveis.
- Paginação e ordenação no servidor para grandes listas.
- Virtualização de tabelas/timelines somente quando o volume justificar.
- Debounce em buscas e cancelamento de requisições obsoletas.
- Cache e `staleTime` específicos por recurso.
- Pausar polling quando a página estiver invisível.
- Evitar rerender de listas inteiras ao atualizar um item.
- Monitorar o bundle no CI e impedir regressões injustificadas.
- Definir metas internas para carregamento, resposta à interação e estabilidade visual nos fluxos principais.

---

## 13. Testes e qualidade

### Ferramentas recomendadas

- ESLint e Prettier.
- Vitest para lógica e hooks.
- React Testing Library para componentes e páginas.
- Mock Service Worker para contratos de API.
- Playwright para fluxos ponta a ponta.
- axe para acessibilidade automatizada.
- Storybook para componentes compartilhados, introduzido após a fundação.

### Pirâmide de testes

| Nível | Cobertura prioritária |
|---|---|
| Unitário | formatadores, normalizadores, filtros, query keys e validação |
| Componente | formulários, tabela, timeline, dialogs e estados de feedback |
| Integração | páginas com API simulada e mutações |
| E2E | cadastrar cliente, consultar processos, filtrar, abrir processo, atualizar movimentos, configurar risco e exportar |
| Visual | componentes essenciais e páginas críticas em desktop/mobile |

### Pipeline de CI

- instalação reprodutível;
- typecheck;
- lint;
- testes unitários e de componentes;
- build;
- E2E dos fluxos críticos;
- auditoria de acessibilidade;
- verificação de tamanho do bundle.

---

## 14. Dependências de backend

Algumas melhorias são exclusivamente frontend; outras dependem da evolução já apontada na análise de processos e movimentos.

| Melhoria | Frontend apenas | Backend necessário |
|---|:---:|---|
| Design system, app shell e responsividade | Sim | Não |
| Rotas e filtros na URL | Sim | Não |
| Feedback, dialogs, skeletons e estados vazios | Sim | Não |
| Tabela com ordenação local e colunas | Sim | Não |
| Ordenação/filtros eficientes em grande volume | Parcial | Paginação, filtros e sort no servidor |
| Timeline visual unificada | Parcial | Endpoint/evento normalizado por fonte e ocorrência |
| Identificação de instância/ocorrência | Parcial | Identificador e metadados consistentes |
| Resumo de conflitos entre fontes | Parcial | Regras e dados de reconciliação |
| Central persistente de tarefas | Parcial | Status, progresso e histórico de jobs |
| Logs e histórico de workers | Parcial | Endpoint de histórico/logs |
| Exportação configurável e assíncrona | Parcial | Job de exportação e armazenamento temporário |
| Simulador de risco/fase | Parcial | Endpoint de simulação ou regras compartilhadas |
| Histórico de configurações | Não | Versionamento/auditoria no backend |

### Contratos prioritários

1. `GET /processes/:id/occurrences` para listar ocorrências, graus e fontes.
2. `GET /processes/:id/timeline` com eventos normalizados e metadados de origem.
3. `POST /processes/:id/refresh` retornando um job rastreável.
4. `GET /jobs` e `GET /jobs/:id` com progresso, resumo e erro.
5. Filtros, ordenação e paginação consistentes nos endpoints de listas.
6. Endpoint de simulação para regras de risco e classificação de fase.

---

## 15. Roadmap de implementação

As estimativas abaixo consideram uma pessoa desenvolvedora frontend com acesso rápido às decisões de produto. Trabalho de backend e validação jurídica não está incluído.

| Fase | Duração estimada | Entregas | Prioridade |
|---|---:|---|:---:|
| 0. Descoberta e baseline | 2–3 dias | inventário de fluxos, screenshots, métricas, mapa de componentes, critérios de aceite | P0 |
| 1. Fundação técnica e visual | 5–7 dias | tokens, componentes base, providers, feedback, lint/testes, estrutura por features | P0 |
| 2. App shell e navegação | 4–6 dias | sidebar, topbar, rotas, contexto na URL, responsividade, central inicial de tarefas | P0 |
| 3. Clientes e processos | 6–9 dias | novos fluxos, busca, filtros, tabela responsiva, estados e deep links | P0 |
| 4. Detalhe e timeline | 6–9 dias | página de processo, ocorrências, timeline unificada, atualização e conflitos | P0 |
| 5. Riscos e configurações | 5–8 dias | editor, simuladores, impacto, confirmação e histórico visual | P1 |
| 6. Operações e relatórios | 4–6 dias | workers, logs, jobs, exportações e histórico | P1 |
| 7. Polimento e hardening | 4–6 dias | acessibilidade, E2E, desempenho, revisão visual e documentação | P0 |

### Prazo agregado

- **Primeira entrega de alto valor:** 17–25 dias de desenvolvimento — fundação, navegação, clientes e processos.
- **Movimentações coerentes e experiência principal concluída:** 23–34 dias, condicionada aos contratos de backend.
- **Escopo completo:** 36–54 dias de desenvolvimento frontend.

O roadmap pode ser entregue em incrementos pequenos, mantendo a aplicação operacional.

---

## 16. Sequência de PRs sugerida

1. Qualidade base: lint, formatter, Vitest, RTL, helpers de teste e CI.
2. Tokens e componentes fundamentais.
3. Providers globais, Error Boundary, toast e política do Query Client.
4. App shell responsivo e novas rotas.
5. Contexto de cliente/processo e filtros na URL.
6. Refatoração de clientes.
7. Refatoração da lista de processos.
8. Página de detalhe do processo.
9. Timeline unificada com adapter temporário para a API atual.
10. Integração com o novo contrato de ocorrências e timeline.
11. Central de tarefas e atualização de processo.
12. Riscos e simulador.
13. Configurações de fase e padrões.
14. Operações/workers.
15. Relatórios e exportações.
16. Acessibilidade, E2E, performance e remoção definitiva do legado em `App.tsx`.

Cada PR deve manter build e testes verdes e remover o código legado equivalente após a migração.

---

## 17. Critérios de aceite

### Globais

- Nenhuma página de negócio nova dentro de `App.tsx`.
- `App.tsx` limitado à composição da aplicação e das rotas.
- Componentes compartilhados documentados e sem estilos literais repetidos.
- Cliente, processo, filtros e abas recuperáveis por URL.
- Todo fluxo assíncrono possui carregamento, sucesso, erro e retry.
- Nenhum fluxo principal exige `window.alert` ou `window.confirm`.
- Navegação por teclado validada nos fluxos críticos.
- Nenhum fluxo principal exige rolagem horizontal no mobile.
- Build, typecheck, lint e testes executados no CI.

### Processos e movimentações

- Abrir um processo a partir da lista em uma ação.
- Retornar à lista preservando página, filtros e scroll.
- Identificar fonte, ocorrência, grau e data em todo movimento.
- Não misturar ocorrências sem aviso e seleção explícita.
- Distinguir claramente ausência de dado, fonte não consultada e falha.
- Atualização mostra escopo, andamento e resumo do resultado.
- Timeline possui busca, filtros e ordenação previsível.

### Segurança operacional

- Exclusões e reprocessamentos mostram consequência e escopo.
- Botões de ação impedem duplo envio.
- Jobs podem ser acompanhados fora da tela de origem.
- Erros técnicos não expõem payloads sensíveis na interface.

---

## 18. Métricas de sucesso

Medir antes e depois:

- tempo para localizar e abrir um processo;
- quantidade de interações para aplicar filtros;
- taxa de filtros sem resultado;
- tempo para identificar a origem de uma movimentação;
- taxa de erro em atualização de processos;
- tarefas iniciadas e abandonadas;
- falhas frontend por sessão;
- uso em mobile e incidência de rolagem horizontal;
- tempo de carregamento e resposta das páginas principais;
- quantidade de regressões detectadas antes da produção;
- chamados relacionados a divergência ou incompreensão de movimentos.

Telemetria deve evitar nomes, documentos, números processuais e textos de movimentações.

---

## 19. Riscos do projeto e mitigação

| Risco | Mitigação |
|---|---|
| Refatoração longa sem valor visível | Entregar por rota e módulo, começando por processos |
| Novo visual sobre dados ainda divergentes | Tratar origem/ocorrência como contrato obrigatório da timeline |
| Duplicidade entre interface antiga e nova | Migrar verticalmente e remover o legado ao concluir cada módulo |
| Biblioteca de componentes excessiva | Começar pelo conjunto mínimo usado nos fluxos P0 |
| Abstrações prematuras | Extrair somente padrões confirmados em duas ou mais telas |
| Testes frágeis | Testar comportamento e acessibilidade, não detalhes de implementação |
| Performance pior após modernização | Lazy routes, budget no CI e medição por etapa |
| Filtros e URL incompatíveis com API atual | Criar adapters no frontend e evoluir contratos gradualmente |
| Usuários estranharem a navegação | Release gradual, ajuda contextual e validação com cenários reais |

---

## 20. Priorização final

### P0 — indispensável

- arquitetura por features;
- tokens e componentes base;
- app shell responsivo;
- contexto em rotas;
- feedback e tratamento de erro;
- clientes e processos;
- detalhe do processo;
- timeline com fonte/ocorrência explícita;
- acessibilidade base;
- testes e CI.

### P1 — alto valor

- dashboard;
- central completa de tarefas;
- riscos com simulação;
- configurações com validação;
- workers e histórico;
- relatórios configuráveis.

### P2 — evolução

- visualizações salvas;
- command palette;
- tema escuro;
- atualização por eventos do servidor;
- versionamento de configurações;
- preferências de densidade;
- telemetria de UX com privacidade.

---

## 21. Recomendação de início

O primeiro ciclo deve combinar **fundação + uma fatia vertical real**:

1. criar tokens, Button, Input, Select/Combobox, Dialog, Toast, Skeleton e estados vazios;
2. implementar o novo app shell e as rotas;
3. migrar a lista de processos;
4. criar o cabeçalho e a página de detalhe;
5. entregar uma primeira timeline unificada por meio de um adapter sobre a API atual;
6. substituir o adapter pelo contrato definitivo assim que o backend normalizar ocorrência, fonte e evento.

Essa sequência melhora imediatamente a aparência e a usabilidade, ao mesmo tempo em que reduz o principal risco funcional do produto: mostrar movimentações sem contexto suficiente para comprovar a relação com o processo identificado.
