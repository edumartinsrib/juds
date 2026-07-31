# Componentes compartilhados do frontend

O frontend usa tokens semânticos definidos em `src/styles.css` e mapeados no
`tailwind.config.ts`. Páginas não devem introduzir cores literais. Os temas
`light`, `dark` e `system` alteram os mesmos tokens.

## Primitivas

- `Button`: variantes `primary`, `secondary`, `ghost` e `danger`; sempre possui
  estado `disabled` e feedback tátil.
- `Field`, `Input`, `Select` e `Textarea`: rótulo acima do controle, dica e erro
  associados ao campo.
- `Dialog` e `ConfirmDialog`: foco inicial, contenção e restauração delegados ao
  Radix Dialog; `Esc` fecha a sobreposição.
- `Drawer`: mesma semântica de dialog, com apresentação lateral no desktop e
  largura total em telas pequenas.
- `DropdownMenu` e `Tooltip`: navegação por teclado e nomes acessíveis.
- `Badge`: tons neutro, marca, sucesso, atenção e perigo; nunca comunica estado
  apenas por cor.
- `Pagination`: informa faixa, total, página e tamanho de página.

## Feedback

- `PageSkeleton`: primeira carga preservando a forma da página.
- `EmptyState`: ausência de dados com explicação e ação contextual.
- `ErrorState`: erro recuperável com retry explícito.
- `InlineAlert`: contexto de fonte, bloqueio, sucesso ou falha.
- `Progress`: andamento com texto, valor numérico e semântica
  `role="progressbar"`.
- `ToastProvider`: feedback breve; a central de tarefas conserva o histórico.

## Componentes jurídicos

- `RiskBadge`, `PhaseBadge`, `SourceBadge`, `DegreeBadge` e `DataStatusBadge`.
- `PartiesSummary` e `RiskEvidence`.
- `ProcessCard`: alternativa responsiva à tabela.
- `MovementTimeline`: eventos agrupados por data com fonte, ocorrência, grau,
  órgão, tipo, risco e registro técnico da origem.

## Estados obrigatórios

Componentes que consultam ou alteram dados devem oferecer carga inicial,
atualização em segundo plano, vazio, erro recuperável, sucesso, bloqueio durante
envio e apresentação mobile. Ações destrutivas usam `ConfirmDialog`; `alert`,
`confirm` e payload técnico bruto não fazem parte da interface.
