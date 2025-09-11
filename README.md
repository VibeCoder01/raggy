# Raggy

A lightweight, local-first RAG server that uses embeddings from a local Ollama instance. It ingests text/markdown/code/PDF files from your filesystem, stores chunk embeddings on disk, and exposes a simple UI and HTTP API for search.

## Features

- Local embeddings via Ollama (`nomic-embed-text` by default)
- Ingest absolute file or folder paths (supports basic globs like `*.md`)
- Text, Markdown, code files, and PDFs supported
- Disk-backed store: `data/embeddings/{registry.json,chunks.jsonl,meta.json}`
- MMR-based re-ranking with tunable parameters
- Simple web UI (served at `/`) and JSON API
- Reset and reingest helpers

## Requirements

- Node.js 18+ (to run the server in `dist/`)
- Ollama running locally (default `http://localhost:11434`)
  - Install: https://ollama.com
  - Pull the embeddings model: `ollama pull nomic-embed-text`

## Quick Start

1) Configure environment

- Create a `.env` from `.env.example` and adjust as needed (defaults work with local Ollama). Note: `.env` is gitignored.

```
PORT=3000
EMBEDDINGS_PROVIDER=ollama
EMBEDDINGS_BASE_URL=http://localhost:11434
EMBEDDINGS_MODEL=nomic-embed-text
SEARCH_MIN_SCORE=0
EMBEDDINGS_CONCURRENCY=4
CHUNK_CHARS=800
CHUNK_OVERLAP=120
```

2) Run the server

- Start: `node dist/index.js`
- The server logs: `Server http://localhost:3000`

3) Open the UI or use the API

- UI: visit `http://localhost:3000/`
- API examples are below.

Note: Static assets are served from `public/` at `/static`. If `public/app.js` is not present, the UI shell will render but interactivity may be limited. The API works independently.

## API

- Health: `GET /health`
- Test Ollama: `GET /ollama/test`
- List ingested docs: `GET /documents`
- Ingest progress: `GET /ingest/progress`
- Reset store: `POST /ingest/reset`
- Reingest from registry: `POST /ingest/reingest`
- Stats (documents/chunks): `GET /ingest/stats`
- Search: `GET /search?q=...&k=5&min=0.3&mmr.lambda=0.5&mmr.pool=80`
- Ingest: `POST /ingest`

Ingest request body:

```
POST /ingest
Content-Type: application/json

{
  "paths": [
    "/abs/path/to/folder",
    "/abs/path/to/file.md",
    "/abs/path/*.txt"
  ]
}
```

Notes:
- Provide absolute paths that exist on the server host.
- Basic globs on the basename (e.g., `*.md`) are supported; recursive `**` matching requires providing expanded paths per folder.
- PDFs are parsed and chunked; non-text binaries are skipped.

Search example:

```
curl "http://localhost:3000/search?q=how%20to%20deploy&k=5&min=0.25"
```

Ingest example:

```
curl -X POST http://localhost:3000/ingest \
  -H 'content-type: application/json' \
  -d '{"paths":["/abs/path/docs","/abs/path/readme.md","/abs/path/*.md"]}'
```

Reset and reingest:

```
curl -X POST http://localhost:3000/ingest/reset
curl -X POST http://localhost:3000/ingest/reingest
```

## Data Layout

- `data/embeddings/registry.json` — ingested documents (ids, paths, metadata)
- `data/embeddings/chunks.jsonl` — one JSON object per chunk with text, embedding, and pointers
- `data/embeddings/meta.json` — store metadata (model, dim, normalization flags)
- Optional: if a compact local index exists at `data/embeddings/index/`, it will be used to accelerate queries

## Configuration

These environment variables tune behavior (defaults shown):

- `PORT=3000` — HTTP port
- `EMBEDDINGS_PROVIDER=ollama` — only Ollama is supported
- `EMBEDDINGS_BASE_URL=http://localhost:11434` — Ollama base URL
- `EMBEDDINGS_MODEL=nomic-embed-text` — embeddings model tag
- `SEARCH_MIN_SCORE=0.5` — default minimum score threshold for results
- `EMBEDDINGS_CONCURRENCY=4` — concurrent embedding requests
- `CHUNK_CHARS=800` — target characters per chunk (approx)
- `CHUNK_OVERLAP=120` — overlap between chunks (approx)
- `MMR_LAMBDA=0.5` — MMR trade-off [0..1]
- `MMR_POOL_BASE=8` — candidate pool multiplier for `k`
- `MMR_POOL_MIN=50` — minimum candidate pool size
- `SENT_TOKENIZER=regex` — sentence splitter strategy (`regex` or `smart`)

You can override any of these via `.env` or the process environment.

## Tips

- Ubuntu + SMB/CIFS shares: mount the share first; do not pass `smb://` or `cifs://` URLs to `/ingest`.

Example (adjust host/share/credentials):

```
sudo apt-get install -y cifs-utils
sudo mkdir -p /mnt/smb_share
sudo mount -t cifs //<host>/<share> /mnt/smb_share -o username=YOUR_USER,vers=3.0,uid=$(id -u),gid=$(id -g)
```

- Deduplication: identical chunk texts within the same file are deduplicated before embedding.
- File name boost: the file name is prepended to text during embedding to improve retrieval.

## Limitations

- Embeddings provider: Ollama only.
- No authentication; expose only on trusted networks.
- UI depends on a `public/` folder for client JS; API works regardless.

## License

MIT — see `LICENSE`.
