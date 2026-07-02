# JUDS

Consulta local de comunicações do DJEN por pessoa com enriquecimento DataJud por processo, backend FastAPI, worker de importação, PostgreSQL via Docker Compose e frontend React/Vite.

## Escopo

- Busca pública no DJEN em `GET /api/v1/comunicacao` usando `nomeParte`, janela incremental padrão de 30 dias e paginação diária com `itensPorPagina=100`.
- Enriquecimento DataJud por `numeroProcesso` nos endpoints públicos `POST /api_publica_{tribunal}/_search`.
- Persistência de clientes, execuções de busca, processos, comunicações, partes e advogados.
- Persistência de capa, classe, órgão, assuntos, grau, sistema, sigilo e movimentos DataJud no processo.
- Enriquecimento processo a processo por número exato, combinando refresh DataJud com busca retroativa no DJEN.
- Gestão de palavras-chave de risco com severidade, categoria, evidência por trecho e reprocessamento das comunicações já importadas.
- CPF é normalizado no backend, mascarado na interface e nunca inferido quando o DJEN não o informa.
- Texto HTML/XML do DJEN é convertido para texto seguro e o conteúdo bruto é preservado para auditoria.
- Exportação em CSV e XLSX.

## Rodando Localmente

```bash
cp .env.example .env
docker compose up --build
```

Configure `DATAJUD_API_KEY` no `.env` local para habilitar o enriquecimento DataJud. O `.env.example` mantém apenas o placeholder da chave.
`PROCESS_ENRICHMENT_WINDOW_DAYS` define a janela retroativa padrão da busca por número de processo quando a data de ajuizamento DataJud não estiver disponível.

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
