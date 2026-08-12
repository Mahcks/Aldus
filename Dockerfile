# syntax=docker/dockerfile:1
FROM oven/bun:1.3.5-alpine AS web
WORKDIR /src/app
COPY app/package.json app/bun.lock app/bunfig.toml ./
RUN bun install --frozen-lockfile
COPY app/ ./
RUN bun run build:web

FROM golang:1.25-alpine AS server
WORKDIR /src/server
COPY server/go.* ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /aldus ./cmd/app

FROM alpine:3.22
RUN apk add --no-cache ffmpeg && addgroup -S aldus && adduser -S -G aldus aldus && mkdir /data /app && chown aldus:aldus /data /app
WORKDIR /app
COPY --from=server /aldus /usr/local/bin/aldus
COPY --from=web /src/app/dist ./public
USER aldus
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["aldus"]
