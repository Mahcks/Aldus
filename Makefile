.PHONY: fixture dev dev-app dev-server build test lint docker

fixture:
	./test-fixtures/alice/fetch.sh

dev:
	@$(MAKE) -j2 dev-server dev-app

dev-app:
	cd app && EXPO_PUBLIC_API_URL=$${EXPO_PUBLIC_API_URL:-http://localhost:8080} bun run start

dev-server:
	cd server && ALDUS_ADDR=:8080 ALDUS_DATA_DIR=../data ALDUS_FIXTURE_DIR=../test-fixtures/alice/media go run ./cmd/app

build:
	cd app && bun run build:web
	cd server && go build ./...

test:
	cd server && go test ./...
	cd server && go test -race ./...
	cd app && bun run typecheck

lint:
	cd server && test -z "$$(gofmt -l .)"
	cd server && go vet ./...
	cd app && bun run lint

docker:
	docker build -t ghcr.io/mahcks/aldus .
