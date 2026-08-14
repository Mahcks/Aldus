.PHONY: fixture seed-alice dev dev-app dev-server web-dev expo-dev ios-dev generate generate-check format format-check build test lint docker docker-alignment

SQLC_VERSION := v1.31.1
TYGO_VERSION := v0.2.21
TOOL_BIN := $(CURDIR)/.tools

fixture:
	./test-fixtures/alice/fetch.sh

seed-alice:
	cd server && ALDUS_ENV=development go run ./cmd/seed-alice --data-dir ../data --fixture-dir ../test-fixtures/alice/media --artifact ../test-fixtures/alice/automatic/hybrid-whisperx/alignment.json

dev:
	@$(MAKE) -j2 dev-server dev-app

dev-app:
	cd app && EXPO_PUBLIC_API_URL=$${EXPO_PUBLIC_API_URL:-http://localhost:8080} bun run start

dev-server:
	cd server && ALDUS_ADDR=:8080 ALDUS_DATA_DIR=../data ALDUS_FIXTURE_DIR=../test-fixtures/alice/media ALDUS_SOURCE_ROOTS=$${ALDUS_SOURCE_ROOTS:-$(CURDIR)/test-fixtures/alice/media} ALDUS_ALLOWED_ORIGINS=$${ALDUS_ALLOWED_ORIGINS:-http://localhost:8081} ALDUS_BOOTSTRAP_TOKEN=$${ALDUS_BOOTSTRAP_TOKEN:-aldus-dev-bootstrap} go run ./cmd/app

web-dev: dev-app

expo-dev:
	@test -n "$$EXPO_PUBLIC_API_URL" || (echo "Set EXPO_PUBLIC_API_URL to the LAN-reachable Aldus origin" >&2; exit 1)
	@PACKAGER_HOST=$$(printf '%s\n' "$$EXPO_PUBLIC_API_URL" | sed -E 's,https?://([^:/]+).*,\1,'); \
	cd app && REACT_NATIVE_PACKAGER_HOSTNAME="$$PACKAGER_HOST" bun run start:dev-client

ios-dev:
	cd app && bun run ios:device

generate:
	mkdir -p $(TOOL_BIN)
	GOBIN=$(TOOL_BIN) go install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION)
	GOBIN=$(TOOL_BIN) go install github.com/gzuidhof/tygo@$(TYGO_VERSION)
	cd server && $(TOOL_BIN)/sqlc generate
	cd server && $(TOOL_BIN)/tygo generate

generate-check: generate
	cd server && $(TOOL_BIN)/sqlc vet
	git diff --exit-code -- server/internal/database/sqlc app/src/generated/api.ts

format:
	cd app && bun run format

format-check:
	cd app && bun run format:check

build:
	cd app && bun run build:web
	cd server && go build ./...

test:
	cd server && go test ./...
	cd server && go test -race ./...
	cd app && bun run test
	cd app && bun run typecheck

lint:
	cd server && test -z "$$(gofmt -l .)"
	cd server && go vet ./...
	$(MAKE) format-check
	cd app && bun run lint

docker:
	docker build -t ghcr.io/mahcks/aldus .

docker-alignment:
	docker build --target alignment -t ghcr.io/mahcks/aldus:alignment .
