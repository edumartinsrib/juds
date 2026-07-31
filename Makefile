.DEFAULT_GOAL := help

PYTHON ?= python3
MIGRATIONS := $(PYTHON) scripts/migrations.py

.PHONY: help migrate migration-status migration-check migration-history

help:
	@echo "Comandos disponíveis:"
	@echo "  make migrate            cria backup e aplica todas as migrations"
	@echo "  make migration-status   mostra a revisão atual e a revisão esperada"
	@echo "  make migration-check    verifica revisão e diferenças de schema"
	@echo "  make migration-history  mostra o histórico completo do Alembic"

migrate:
	@$(MIGRATIONS) upgrade

migration-status:
	@$(MIGRATIONS) status

migration-check:
	@$(MIGRATIONS) check

migration-history:
	@$(MIGRATIONS) history
