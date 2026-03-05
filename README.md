# Second Brain MCP

A personal knowledge base server built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Store, search, and connect notes, decisions, and ideas — then query them directly from Claude or any MCP-compatible client.

## Overview

The server exposes a set of MCP tools that let an AI assistant read and write to a Supabase-backed knowledge store. Each request is stateless — no sessions, no persistent connections.

**Stack:** Node.js · TypeScript · Express · MCP SDK · Supabase · Zod

## Prerequisites

- Node.js ≥ 20
- A Supabase project with the required schema (see [Database Schema](#database-schema))

## Setup

1. Clone and install dependencies:
   ```bash
   git clone https://github.com/VanNeutron/second-brain-mcp.git
   cd second-brain-mcp
   npm install
   ```

2. Create a `.env` file (not committed):
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   PORT=3000
   ```

3. Build and run:
   ```bash
   npm run build
   npm start
   ```

## Development

```bash
npm run dev    # TypeScript watch mode (recompiles on save)
npm run build  # One-off compile to dist/
```

## Authentication

All requests to `POST /mcp` require a `Bearer` token:

```
Authorization: Bearer <your-api-key>
```

API keys are stored in Supabase as SHA-256 hashes. Each key has a name, permission list, optional expiry, and an `is_active` flag. The server updates `last_used_at` on every successful authentication.

## MCP Tools

| Tool | Description |
|------|-------------|
| `brain_save` | Save a new entry with title, content, category, tags, keywords, and importance |
| `brain_search` | Full-text search with filters for category, tags, keywords, importance, date range |
| `brain_get` | Retrieve a single entry with full content, tags, and linked entries |
| `brain_list_recent` | List recent entries, optionally filtered by category |
| `brain_update` | Update fields on an existing entry (metadata is merged, not replaced) |
| `brain_delete` | Permanently delete an entry |
| `brain_tag` | Add or remove tags on an entry |
| `brain_link` | Create or remove typed relationships between entries |
| `brain_related` | Find entries related via explicit links or shared tags/keywords/category |
| `brain_categories` | List all categories with entry counts |

**Relationship types for `brain_link`:** `relates_to`, `follows_up`, `supports`, `contradicts`, `part_of`, `led_to`

**Importance scale for `brain_save`:** 1 = trivial, 3 = normal, 5 = critical decision or key reference

## Database Schema

The server expects the following Supabase tables:

- `entries` — the main knowledge store
- `categories` — pre-seeded categories (entries must reference an existing category by name)
- `tags` / `entry_tags` — many-to-many tag relationships
- `entry_links` — typed directional links between entries
- `api_keys` — hashed API keys for authentication

And the following Postgres functions (RPCs):

- `search_entries` — full-text search with filters
- `get_entry_full` — entry + tags + links in one call
- `find_related_entries` — explicit + implicit similarity scoring
- `list_categories_with_counts` — categories with entry counts

## Deployment

A `Dockerfile` is included for containerised deployments. The server exposes port 3000 and responds to `GET /health` for health checks (used by Railway).

```bash
docker build -t second-brain-mcp .
docker run -p 3000:3000 \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  second-brain-mcp
```

## Connecting to Claude

Add the server to your MCP client config. Example for Claude Desktop:

```json
{
  "mcpServers": {
    "second-brain": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```
