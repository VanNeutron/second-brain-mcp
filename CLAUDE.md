# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Watch mode (tsc --watch)
npm start          # Run compiled server (node dist/index.js)
```

No test suite exists yet. TypeScript compilation (`npm run build`) serves as the primary correctness check.

To run locally, set environment variables first:
```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
# Optional: PORT (default: 3000) or MCP_SERVER_PORT
node dist/index.js
```

## Architecture

This is a **stateless MCP (Model Context Protocol) server** exposing a personal knowledge base ("second brain") over HTTP. Each POST to `/mcp` creates a fresh `McpServer` + `StreamableHTTPServerTransport` instance — there are no sessions.

**Request lifecycle:**
1. Express receives `POST /mcp`
2. `authenticateRequest` (`src/auth.ts`) hashes the Bearer token with SHA-256, looks it up in the Supabase `api_keys` table, checks `is_active` and `expires_at`
3. A new `McpServer` is created and `registerTools` wires up all tools
4. The transport handles the MCP protocol exchange and closes on response end

**Source files:**
- `src/index.ts` — Express server, `/health` endpoint, `/mcp` handler
- `src/auth.ts` — Bearer token → SHA-256 hash → Supabase `api_keys` lookup
- `src/tools.ts` — All MCP tools registered via `server.tool()`
- `src/supabase.ts` — Singleton Supabase client (service role key)

**MCP Tools (all in `src/tools.ts`):**
- `brain_save` — Insert a new entry; upserts tags; category must already exist
- `brain_search` — Full-text search via `search_entries` RPC; tag filtering done client-side
- `brain_get` — Retrieve one entry with links via `get_entry_full` RPC
- `brain_list_recent` — Recent entries with optional category filter
- `brain_update` — Patch entry fields; metadata is merged (not replaced)
- `brain_delete` — Hard delete
- `brain_tag` — Add/remove tags (normalized to lowercase)
- `brain_link` — Create/remove typed relationships between entries (`relates_to`, `follows_up`, `supports`, `contradicts`, `part_of`, `led_to`)
- `brain_related` — Find related entries via `find_related_entries` RPC (explicit links + implicit similarity)
- `brain_categories` — List categories via `list_categories_with_counts` RPC

**Supabase schema (inferred):**
- Tables: `entries`, `categories`, `tags`, `entry_tags`, `entry_links`, `api_keys`
- RPCs: `search_entries`, `get_entry_full`, `find_related_entries`, `list_categories_with_counts`
- Categories must be pre-seeded; tools look them up by name

**Deployment:** Dockerfile builds a two-stage image (builder + slim runtime), exposing port 3000. Designed for Railway (uses `/health` check).
