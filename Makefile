.PHONY: fixture demo-media seed-alice dev dev-app dev-docs dev-server web-dev expo-dev ios-dev generate generate-check format format-check build test lint acceptance backup restore docker docker-alignment release-smoke release release-all demo-deploy ios-testflight ios-testflight-remote ios-external ios-release

SQLC_VERSION := v1.31.1
TYGO_VERSION := v0.2.21
TOOL_BIN := $(CURDIR)/.tools

fixture:
	./test-fixtures/alice/fetch.sh

demo-media:
	./demo/fetch.sh

seed-alice:
	cd server && ALDUS_ENV=development go run ./cmd/seed-alice --data-dir ../data --fixture-dir ../test-fixtures/alice/media --artifact ../test-fixtures/alice/automatic/hybrid-whisperx/alignment.json

dev:
	@$(MAKE) -j2 dev-server dev-app

dev-app:
	cd app && EXPO_PUBLIC_API_URL=$${EXPO_PUBLIC_API_URL:-http://localhost:8080} bun run start

dev-docs:
	cd docs && bun run dev

dev-server:
	@LAN_ORIGINS=$$(ip -4 -o addr show scope global | awk '{split($$4, address, "/"); printf ",http://%s:8081", address[1]}'); \
	cd server && ALDUS_ENV=$${ALDUS_ENV:-development} ALDUS_LOG_LEVEL=$${ALDUS_LOG_LEVEL:-debug} ALDUS_ADDR=:8080 ALDUS_DATA_DIR=../data ALDUS_BACKUP_DIR=../backups ALDUS_FIXTURE_DIR=../test-fixtures/alice/media ALDUS_SOURCE_ROOTS=$${ALDUS_SOURCE_ROOTS:-$(CURDIR)/library-media,$(CURDIR)/test-fixtures/alice/media} ALDUS_ALLOWED_ORIGINS=$${ALDUS_ALLOWED_ORIGINS:-http://localhost:8081$$LAN_ORIGINS} go run ./cmd/app

web-dev: dev-app

expo-dev:
	@API_URL="$$EXPO_PUBLIC_API_URL"; \
	 if test -n "$$API_URL"; then PACKAGER_HOST=$$(printf '%s\n' "$$API_URL" | sed -E 's,https?://([^:/]+).*,\1,'); \
	 elif command -v ip >/dev/null; then PACKAGER_HOST=$$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($$i=="src") {print $$(i+1); exit}}'); \
	 elif command -v ipconfig >/dev/null; then INTERFACE=$$(route -n get default 2>/dev/null | awk '/interface:/{print $$2}'); PACKAGER_HOST=$$(ipconfig getifaddr "$$INTERFACE"); \
	 fi; \
	 test -n "$$PACKAGER_HOST" || (echo "Could not detect a LAN address; set EXPO_PUBLIC_API_URL once for this network" >&2; exit 1); \
	 API_URL=$${API_URL:-http://$$PACKAGER_HOST:8080}; \
	 echo "Starting Aldus for http://$$PACKAGER_HOST:8080"; \
	 cd app && EXPO_PUBLIC_API_URL="$$API_URL" EXPO_PUBLIC_WEB_API_URL=$${EXPO_PUBLIC_WEB_API_URL:-http://localhost:8080} REACT_NATIVE_PACKAGER_HOSTNAME="$$PACKAGER_HOST" bun run start:dev-client

ios-dev:
	cd app && bun run ios:device

release:
	@test -n "$(VERSION)" || (echo "Set VERSION, for example: make release VERSION=0.1.0-beta.16" >&2; exit 1)
	./scripts/release.sh release "$(VERSION)"

release-all:
	@test -n "$(VERSION)" || (echo "Set VERSION, for example: make release-all VERSION=0.1.0-beta.16" >&2; exit 1)
	./scripts/release.sh release "$(VERSION)"
	./scripts/ios-release.sh testflight

demo-deploy:
	@test -n "$(VERSION)" || (echo "Set VERSION, for example: make demo-deploy VERSION=0.1.0-beta.16" >&2; exit 1)
	./scripts/release.sh demo "$(VERSION)"

ios-testflight:
	./scripts/ios-release.sh testflight

ios-testflight-remote:
	./scripts/ios-release.sh remote "$(REF)"

ios-external:
	@test -n "$(BUILD_ID)" || (echo "Set BUILD_ID to the processed App Store Connect build ID" >&2; exit 1)
	./scripts/ios-release.sh external "$(BUILD_ID)"

ios-release:
	@test -n "$(VERSION)" || (echo "Set VERSION to the App Store version, for example 0.1.0" >&2; exit 1)
	@test -n "$(BUILD_ID)" || (echo "Set BUILD_ID to the tested App Store Connect build ID" >&2; exit 1)
	./scripts/ios-release.sh release "$(VERSION)" "$(BUILD_ID)"

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

acceptance:
	cd server && go test ./internal/api -run TestExactProgressCrossClientAcceptance -count=1

backup:
	@test -n "$(BACKUP)" || (echo "Set BACKUP to a new .tar.gz path" >&2; exit 1)
	cd server && go run ./cmd/app backup --data-dir ../data --archive "$(abspath $(BACKUP))"

restore:
	@test -n "$(BACKUP)" || (echo "Set BACKUP to an existing .tar.gz path" >&2; exit 1)
	@test -n "$(RESTORE_DIR)" || (echo "Set RESTORE_DIR to a new or empty directory" >&2; exit 1)
	cd server && go run ./cmd/app restore --archive "$(abspath $(BACKUP))" --data-dir "$(abspath $(RESTORE_DIR))"

lint:
	cd server && test -z "$$(gofmt -l .)"
	cd server && go vet ./...
	$(MAKE) format-check
	cd app && bun run lint

docker:
	docker build -t ghcr.io/mahcks/aldus .

docker-alignment:
	docker build --target alignment -t ghcr.io/mahcks/aldus:alignment .

release-smoke:
	./scripts/release-smoke.sh "$${IMAGE:-aldus:ci}"
