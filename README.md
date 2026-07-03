# JUDS

Gestao local de processos, movimentacoes e informacoes complementares por pessoa, com backend FastAPI, worker de importacao, PostgreSQL via Docker Compose e frontend React/Vite.

## Escopo

- Busca publica de movimentacoes por `nomeParte`, janela incremental padrao de 30 dias e paginacao diaria.
- Enriquecimento por `numeroProcesso` com informacoes complementares do processo.
- Persistência de clientes, execuções de busca, processos, comunicações, partes e advogados.
- Persistência de capa, classe, órgão, assuntos, grau, sistema, sigilo e historico complementar no processo.
- Atualizacao processo a processo por numero exato, combinando dados complementares com busca retroativa de movimentacoes.
- Gestão de palavras-chave de risco com severidade, categoria, evidência por trecho e reprocessamento das comunicações já importadas.
- Controle de robos de busca com registro de instâncias, sinal de atividade, busca atual, início sob demanda pela API e solicitação de parada.
- CPF é normalizado no backend, mascarado na interface e nunca inferido quando a fonte não o informa.
- Texto HTML/XML importado é convertido para texto seguro e o conteúdo bruto é preservado para auditoria.
- Exportação em CSV e XLSX.

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
- `POST /api/clients/{id}/search-runs`
- `GET /api/search-runs/{id}`
- `GET /api/workers`
- `POST /api/workers`
- `POST /api/workers/{id}/stop`
- `GET /api/processes?client_id=...`
- `GET /api/processes/{id}`
- `POST /api/processes/{id}/enrich`
- `GET /api/communications/{id}`
- `GET /api/risk-keywords`
- `POST /api/risk-keywords`
- `PATCH /api/risk-keywords/{id}`
- `DELETE /api/risk-keywords/{id}`
- `POST /api/risk-keywords/reprocess`
- `GET /api/exports?client_id=...&format=csv|xlsx`
