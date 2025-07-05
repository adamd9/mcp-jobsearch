# MCP Job Search Node

This project implements the server described in `mcp-jobsearch-node.md`. It scrapes LinkedIn job listings, filters them using an LLM, stores matches, and exposes MCP-compatible HTTP endpoints.

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials.
2. Install dependencies with `npm install` (already done if cloned with `node_modules`).
3. Start the server with `npm start`.

## Endpoints

- `GET /latest_matches` – Returns the most recent JSON array of job matches.
- `POST /send_digest` – Body `{ "email": "you@example.com" }`. Scrapes, filters and emails the matches.

The daily cron task runs at 07:00 AEST and emails the digest automatically.
