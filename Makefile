# 汉语 · Révision de vocabulaire chinois — démarrage, déploiement et exploitation.
#
# `make` sans cible affiche la liste. Les cibles de déploiement s'exécutent sur le serveur
# lui-même ; deploy/README.md explique ce qu'elles font.

# Docker ou Podman : celui qui est installé.
COMPOSE := $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo "podman compose")
APP_PORT := $(shell grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2)
APP_PORT := $(or $(APP_PORT),8000)

.DEFAULT_GOAL := help
.PHONY: help install upgrade up down restart logs ps build health backup restore shell-db password

help: ## Affiche cette aide
	@echo "汉语 · Révision de vocabulaire chinois"
	@echo ""
	@echo "Première installation sur un serveur :"
	@echo "  make install DOMAIN=chinois.example.com EMAIL=toi@example.com"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F'## ' '{split($$1, t, ":"); printf "  %-10s %s\n", t[1], $$2}'
	@echo ""

# ------------------------------------------------------------------ déploiement

install: ## Installe tout sur ce serveur (DOMAIN=... EMAIL=... ; relançable)
	@bash deploy/install.sh

upgrade: ## Met à jour : sauvegarde, git pull, reconstruit, redémarre
	@bash deploy/upgrade.sh

# ------------------------------------------------------------------ au quotidien

up: ## Démarre l'application (http://localhost:8000)
	$(COMPOSE) up -d --build

down: ## Arrête l'application (les données sont gardées)
	$(COMPOSE) down

restart: ## Redémarre le conteneur de l'application
	$(COMPOSE) restart app

logs: ## Suit le journal de l'application
	$(COMPOSE) logs -f app

ps: ## Conteneurs en cours et leurs ports
	$(COMPOSE) ps

build: ## Reconstruit l'image
	$(COMPOSE) build

health: ## Vérifie que l'application répond
	@curl -sf http://127.0.0.1:$(APP_PORT)/api/health && echo "" || (echo "L'application ne répond pas : make logs" && exit 1)

# ------------------------------------------------------------------ données

backup: ## Sauvegarde la base dans backups/
	@bash deploy/backup.sh

restore: ## Restaure une sauvegarde (FILE=backups/....sql.gz), remplace la base
	@bash deploy/restore.sh "$(FILE)"

# ------------------------------------------------------------------ comptes

password: ## Nouveau mot de passe pour un compte (ACCOUNT=admin ; le crée administrateur s'il manque)
	@test -n "$(ACCOUNT)" || (echo "Usage : make password ACCOUNT=identifiant" && exit 1)
	$(COMPOSE) exec app python -m app.cli password "$(ACCOUNT)"

shell-db: ## Ouvre psql sur la base
	$(COMPOSE) exec db sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'
