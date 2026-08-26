---
title: Install Aldus
description: Start the Aldus server with Docker Compose.
---

## Requirements

- Docker with Compose
- A persistent directory for Aldus data
- A folder containing media you own

```sh
git clone https://github.com/mahcks/aldus.git
cd aldus
cp .env.example .env
docker compose up -d
```

Open `http://localhost:8080` and create the first account. It becomes the server administrator.

Pin a release in `.env` before relying on the server for important data. Avoid `latest` when you need predictable upgrades.
