# JUDS

Gestao local de processos, movimentacoes e informacoes complementares por pessoa, com backend FastAPI, worker de importacao, PostgreSQL via Docker Compose e frontend React/Vite.

## Escopo

- Busca publica de publicacoes DJEN por `nomeParte`, janela incremental padrao de 30 dias e paginacao diaria.
- Enriquecimento por `numeroProcesso` com informacoes complementares do processo.
- Persistência de clientes, execuções de busca, processos, comunicações, partes e advogados.
- Processo canonico separado de instancias oficiais DataJud, snapshots brutos e eventos normalizados por fonte.
- Seleção DataJud deterministica por numero exato, com bloqueio de capa e fila de revisão quando houver ambiguidade.
- Reconciliação versionada de retificações DJEN, inclusive revinculo transacional para outro processo.
- Associação explícita cliente–publicação nos estados `confirmed`, `probable`, `uncertain` e `rejected`.
- Timeline única, mais recente primeiro, com publicações DJEN e movimentos DataJud identificados separadamente.
- Atualizacao processo a processo por numero exato, combinando dados complementares com busca retroativa de movimentacoes.
- Busca de movimentacoes com periodo configuravel, atalhos de janela e reprocessamento opcional de riscos ao concluir.
- Gestão de palavras-chave de risco com severidade, categoria, evidência por trecho e reprocessamento das comunicações já importadas.
- Configuracao de palavras-chave para fases processuais, com padroes de execucao e classificacao por DJEN/DataJud.
- Controle de robos de busca com registro de instâncias, sinal de atividade, busca atual, início sob demanda pela API e solicitação de parada.
- CPF é normalizado no backend, mascarado na interface e nunca inferido quando a fonte não o informa.
- Texto HTML/XML importado é convertido para texto seguro e o conteúdo bruto é preservado para auditoria.
- Exportação em CSV e XLSX.
- Auditoria persistida de integridade, com comando de saneamento e justificativa manual de divergências legítimas.

## Rodando Localmente

```bash
cp .env.example .env
make migrate
docker compose up --build
```

Configure `DATAJUD_API_KEY` no `.env` local para habilitar o enriquecimento complementar. O `.env.example` mantém apenas o placeholder da chave.
`PROCESS_ENRICHMENT_WINDOW_DAYS` define a janela retroativa padrão da busca por número de processo quando a data de ajuizamento não estiver disponível.

Serviços:

- API: http://localhost:8000
- Frontend: http://localhost:5173
- PostgreSQL: localhost:5432

## Comandos De Desenvolvimento

Backend:

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
pytest
python -m app.audit --repair-normalized-data --fail-on-findings
```

Frontend:

```bash
cd frontend
npm install
npm run build
```

## API Local

- `POST /api/clients`
- `GET /api/clients`
- `PATCH /api/clients/{id}`
- `DELETE /api/clients/{id}`
- `POST /api/clients/{id}/search-runs`
- `GET /api/search-runs/{id}`
- `GET /api/workers`
- `POST /api/workers`
- `POST /api/workers/{id}/stop`
- `GET /api/processes?client_id=...`
- `GET /api/processes/page?client_id=...&page=1&page_size=10&process_class=...&defendant=...`
- `GET /api/processes/filter-options?client_id=...`
- `GET /api/processes/{id}`
- `POST /api/processes/{id}/enrich`
- `POST /api/processes/{id}/sources/{source_id}/select`
- `POST /api/integrity/audit`
- `GET /api/integrity/issues?status=open`
- `PATCH /api/integrity/issues/{id}/resolve`
- `GET /api/process-phase-keywords`
- `POST /api/process-phase-keywords`
- `PATCH /api/process-phase-keywords/{id}`
- `DELETE /api/process-phase-keywords/{id}`
- `POST /api/process-phase-keywords/defaults`
- `GET /api/communications/{id}`
- `GET /api/risk-keywords`
- `POST /api/risk-keywords`
- `PATCH /api/risk-keywords/{id}`
- `DELETE /api/risk-keywords/{id}`
- `POST /api/risk-keywords/reprocess`
- `GET /api/exports?client_id=...&format=csv|xlsx`

## Migrations

Use o comando abaixo na raiz do projeto:

```bash
make migrate
```

Esse é o fluxo recomendado tanto no primeiro uso quanto depois de atualizar o código. Ele:

- valida o Docker, o Compose e o `.env`;
- sobe somente o PostgreSQL e aguarda o healthcheck;
- recompila a imagem do backend para não executar migrations antigas;
- compara a revisão atual com o `head` do Alembic;
- quando há migrations pendentes, cria e valida um backup em
  `backups/juds-before-migrate-AAAAMMDD-HHMMSS.dump`;
- injeta a referência do backup em `JUDS_MIGRATION_BACKUP_REFERENCE`, aplica o `head`
  e executa `alembic check`.

Se o banco já estiver atualizado, o comando apenas valida o schema e não cria outro backup.
O diretório `backups/` é local e ignorado pelo Git; cada arquivo é criado com permissão
privada (`0600`).

Comandos auxiliares:

```bash
make migration-status
make migration-check
make migration-history
```

Evite usar o `alembic upgrade head` manualmente em um banco com dados: esse atalho não cria
backup nem registra automaticamente sua referência. O startup da API ainda aplica o `head`
para manter o ambiente local compatível, mas execute `make migrate` antes de
`docker compose up --build` quando houver dados que precisam ser preservados.

### Solução de problemas

- `Arquivo .env ausente`: execute `cp .env.example .env` e revise as credenciais.
- Erro ao conectar no Docker: inicie o Docker Engine e repita `make migrate`.
- Falha na migration: o caminho do backup preservado é mostrado no final da saída. Corrija
  a causa e execute `make migrate` novamente; migrations concluídas não são reaplicadas.
- Para mudar apenas o diretório dos backups, execute
  `JUDS_MIGRATION_BACKUP_DIR=/caminho/seguro make migrate`.

Para restaurar um backup, pare a API e o worker e use o arquivo indicado pelo comando:

```bash
docker compose stop api worker
docker compose exec -T postgres sh -ceu \
  'exec pg_restore --clean --if-exists --no-owner --no-privileges \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  < backups/juds-before-migrate-AAAAMMDD-HHMMSS.dump
```

A restauração substitui os objetos existentes no banco alvo. Confirme o arquivo e o ambiente
antes de executá-la.

Após migrations com saneamento de dados, execute também:

```bash
docker compose run --rm --no-deps api python -m app.audit \
  --repair-normalized-data \
  --resync-flagged \
  --fail-on-findings
```

O código de saída `2` indica divergências abertas. Casos legítimos podem ser justificados
pela API de ocorrências; a auditoria não reabre uma justificativa registrada. A migração
`0006_process_source_integrity` mantém o relatório antes/depois em `data_migration_runs`
e os remapeamentos em `data_migration_mappings`.
