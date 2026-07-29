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

## Migração segura dos dados existentes

Antes de subir a versão que contém a migração `0006_process_source_integrity`, gere um backup e registre sua referência:

```bash
mkdir -p backups
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-juds}" -d "${POSTGRES_DB:-juds}" \
  > "backups/juds-before-0006-$(date +%Y%m%d-%H%M%S).sql"
```

Defina `JUDS_MIGRATION_BACKUP_REFERENCE` no `.env` com o caminho do backup e então aplique a versão. A migração mantém um relatório antes/depois em `data_migration_runs` e os remapeamentos em `data_migration_mappings`.

Após a subida:

```bash
docker compose exec -T api python -m app.audit \
  --repair-normalized-data \
  --resync-flagged \
  --fail-on-findings
```

O código de saída `2` indica divergências abertas. Casos legítimos podem ser justificados pela API de ocorrências; a auditoria não reabre uma justificativa registrada.
