# Requires Docker (Compose v2), and for `make test` a JDK 21 and Node 22.
.PHONY: up down logs test test-backend test-frontend test-transcription seed e2e clean

up:            ## Build, start, wait until healthy (frontend waits on everything else), then seed
	docker compose up -d --build --wait frontend
	docker compose up --no-log-prefix seed

down:          ## Stop the stack (data volumes are kept)
	docker compose down

logs:          ## Follow logs from all services
	docker compose logs -f --tail=100

test: test-backend test-frontend test-transcription

test-backend:  ## Unit tests + Testcontainers integration tests (those need Docker)
	cd backend && ./mvnw -B test

test-frontend:
	cd frontend && npm ci && npx ng test --watch=false

test-transcription:  ## Runs inside the service's image, so no local Python is needed
	docker compose run --rm --no-deps -e PRELOAD_MODELS=false -v "$(CURDIR)/transcription-service/tests:/srv/tests:ro" \
		transcription-service sh -c "pip install -q pytest==9.2.0 && python -m pytest -q tests"

seed:          ## Upload the sample recording (no-op if already there)
	sh infra/scripts/seed.sh

e2e:           ## Upload -> wait for INDEXED -> search -> check timestamp and Range streaming
	sh infra/scripts/e2e-check.sh

clean:         ## Stop the stack AND delete the database, uploaded media and model cache
	docker compose down -v
