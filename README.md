# JUDS

Consulta local de comunicações do DJEN por pessoa, com backend FastAPI, worker de importação, PostgreSQL via Docker Compose e frontend React/Vite.

## Escopo

- Busca pública em `GET /api/v1/comunicacao` usando `nomeParte`, janela incremental padrão de 30 dias e paginação diária com `itensPorPagina=100`.
- Persistência de clientes, execuções de busca, processos, comunicações, partes e advogados.
- CPF é normalizado no backend, mascarado na interface e nunca inferido quando o DJEN não o informa.
- Texto HTML/XML do DJEN é convertido para texto seguro e o conteúdo bruto é preservado para auditoria.
- Exportação em CSV e XLSX.

## Rodando Localmente

```bash
cp .env.example .env
docker compose up --build
```

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
- `GET /api/communications/{id}`
- `GET /api/exports?client_id=...&format=csv|xlsx`
