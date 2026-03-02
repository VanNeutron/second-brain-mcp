import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabase } from "./supabase.js";

// Valid relationship types for entry_links
const RELATIONSHIP_TYPES = [
  "relates_to",
  "follows_up",
  "supports",
  "contradicts",
  "part_of",
  "led_to",
] as const;

export function registerTools(server: McpServer) {
  // ── brain_save ──────────────────────────────────────────────
  server.tool(
    "brain_save",
    `Save a new entry to the brain. When saving, generate a clear title, 1-2 sentence summary, and 3-7 relevant keywords. Choose the most appropriate category. Assess importance: 1=trivial, 3=normal, 5=critical decision or key reference. If this relates to existing entries, use brain_link afterward.`,
    {
      content: z.string().describe("The full text/markdown content to store"),
      title: z.string().describe("Short descriptive title"),
      summary: z
        .string()
        .optional()
        .describe("1-2 sentence summary (recommended)"),
      category: z
        .string()
        .describe("Category name (must match existing category)"),
      keywords: z
        .array(z.string())
        .optional()
        .describe("Relevant keywords for search"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tag names (created if they don't exist)"),
      importance: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe("1-5 scale (default: 3)"),
      source: z
        .string()
        .optional()
        .describe('Origin identifier (default: "mcp")'),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe("Arbitrary additional data"),
    },
    async ({ content, title, summary, category, keywords, tags, importance, source, metadata }) => {
      // Look up category
      const { data: cat, error: catErr } = await supabase
        .from("categories")
        .select("id")
        .eq("name", category)
        .single();

      if (catErr || !cat) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Category "${category}" not found. Use brain_categories to see available categories.`,
            },
          ],
        };
      }

      // Insert entry
      const { data: entry, error: entryErr } = await supabase
        .from("entries")
        .insert({
          title,
          content,
          summary: summary ?? null,
          category_id: cat.id,
          source: source ?? "mcp",
          keywords: keywords ?? [],
          importance: importance ?? 3,
          metadata: metadata ?? {},
        })
        .select("id, title, created_at")
        .single();

      if (entryErr || !entry) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error saving entry: ${entryErr?.message ?? "Unknown error"}`,
            },
          ],
        };
      }

      // Handle tags if provided
      if (tags && tags.length > 0) {
        for (const tagName of tags) {
          const normalizedTag = tagName.toLowerCase().trim();

          // Upsert tag
          const { data: tag } = await supabase
            .from("tags")
            .upsert({ name: normalizedTag }, { onConflict: "name" })
            .select("id")
            .single();

          if (tag) {
            await supabase
              .from("entry_tags")
              .insert({ entry_id: entry.id, tag_id: tag.id })
              .select();
          }
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                id: entry.id,
                title: entry.title,
                created_at: entry.created_at,
                category,
                tags: tags ?? [],
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── brain_search ────────────────────────────────────────────
  server.tool(
    "brain_search",
    `Search the brain using full-text search with optional metadata filters. Returns ranked results with title, summary, content preview, category, relevance score, and created date. Use brain_get to retrieve full content for a specific entry.`,
    {
      query: z.string().describe("Natural language search query"),
      category: z.string().optional().describe("Filter by category name"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter to entries with ALL specified tags"),
      keywords: z
        .array(z.string())
        .optional()
        .describe("Filter to entries containing ANY of these keywords"),
      importance_min: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe("Minimum importance level"),
      source: z.string().optional().describe("Filter by source"),
      after: z
        .string()
        .optional()
        .describe("ISO date — only entries created after this date"),
      before: z
        .string()
        .optional()
        .describe("ISO date — only entries created before this date"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results (default: 10, max: 50)"),
    },
    async ({ query, category, tags, keywords, importance_min, source, after, before, limit }) => {
      const { data, error } = await supabase.rpc("search_entries", {
        search_query: query,
        filter_category: category ?? null,
        filter_source: source ?? null,
        min_importance: importance_min ?? null,
        filter_keywords: keywords ?? null,
        after_date: after ?? null,
        before_date: before ?? null,
        max_results: limit ?? 10,
      });

      if (error) {
        return {
          content: [
            { type: "text" as const, text: `Search error: ${error.message}` },
          ],
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No results found. Try different search terms or fewer filters.",
            },
          ],
        };
      }

      // If tag filtering is requested, do it client-side (join not available in the RPC)
      let results = data;
      if (tags && tags.length > 0) {
        const entryIds = results.map((r: { id: string }) => r.id);
        const { data: tagData } = await supabase
          .from("entry_tags")
          .select("entry_id, tags(name)")
          .in("entry_id", entryIds);

        if (tagData) {
          // Build map of entry_id → tag names
          const entryTags: Record<string, string[]> = {};
          for (const row of tagData as unknown as Array<{ entry_id: string; tags: { name: string } }>) {
            if (!entryTags[row.entry_id]) entryTags[row.entry_id] = [];
            entryTags[row.entry_id].push(row.tags.name);
          }

          // Filter to entries that have ALL required tags
          results = results.filter((r: { id: string }) => {
            const eTags = entryTags[r.id] || [];
            return tags.every((t) => eTags.includes(t.toLowerCase()));
          });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  // ── brain_get ───────────────────────────────────────────────
  server.tool(
    "brain_get",
    "Retrieve a single entry with full content, all tags, and all links (both directions).",
    {
      id: z.string().uuid().describe("Entry UUID"),
    },
    async ({ id }) => {
      const { data, error } = await supabase.rpc("get_entry_full", {
        entry_uuid: id,
      });

      if (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving entry: ${error.message}`,
            },
          ],
        };
      }

      if (!data) {
        return {
          content: [
            { type: "text" as const, text: `Entry not found: ${id}` },
          ],
        };
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data, null, 2) },
        ],
      };
    }
  );

  // ── brain_list_recent ───────────────────────────────────────
  server.tool(
    "brain_list_recent",
    'Get the most recent entries, optionally filtered by category. Useful for "what have I been thinking about lately" queries.',
    {
      category: z.string().optional().describe("Filter by category"),
      days: z
        .number()
        .optional()
        .describe("How many days back to look (default: 7)"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results (default: 20)"),
    },
    async ({ category, days, limit }) => {
      const daysBack = days ?? 7;
      const maxResults = limit ?? 20;
      const since = new Date();
      since.setDate(since.getDate() - daysBack);

      let query = supabase
        .from("entries")
        .select(
          "id, title, summary, source, keywords, importance, created_at, category_id, categories(name)"
        )
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(maxResults);

      if (category) {
        const { data: cat } = await supabase
          .from("categories")
          .select("id")
          .eq("name", category)
          .single();

        if (cat) {
          query = query.eq("category_id", cat.id);
        } else {
          return {
            content: [
              {
                type: "text" as const,
                text: `Category "${category}" not found.`,
              },
            ],
          };
        }
      }

      const { data, error } = await query;

      if (error) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${error.message}` },
          ],
        };
      }

      const results = (data ?? []).map((e: Record<string, unknown>) => ({
        id: e.id,
        title: e.title,
        summary: e.summary,
        category: (e.categories as { name: string } | null)?.name ?? null,
        source: e.source,
        keywords: e.keywords,
        importance: e.importance,
        created_at: e.created_at,
      }));

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    }
  );

  // ── brain_update ────────────────────────────────────────────
  server.tool(
    "brain_update",
    "Update an existing entry's content or metadata. Only provide fields you want to change.",
    {
      id: z.string().uuid().describe("Entry UUID"),
      title: z.string().optional().describe("New title"),
      content: z.string().optional().describe("New content"),
      summary: z.string().optional().describe("New summary"),
      category: z.string().optional().describe("New category name"),
      keywords: z
        .array(z.string())
        .optional()
        .describe("New keywords (replaces existing)"),
      importance: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe("New importance"),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe("Merged with existing metadata"),
    },
    async ({ id, title, content, summary, category, keywords, importance, metadata }) => {
      const updates: Record<string, unknown> = {};
      if (title !== undefined) updates.title = title;
      if (content !== undefined) updates.content = content;
      if (summary !== undefined) updates.summary = summary;
      if (keywords !== undefined) updates.keywords = keywords;
      if (importance !== undefined) updates.importance = importance;

      if (category !== undefined) {
        const { data: cat } = await supabase
          .from("categories")
          .select("id")
          .eq("name", category)
          .single();

        if (!cat) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Category "${category}" not found.`,
              },
            ],
          };
        }
        updates.category_id = cat.id;
      }

      if (metadata !== undefined) {
        // Fetch existing metadata and merge
        const { data: existing } = await supabase
          .from("entries")
          .select("metadata")
          .eq("id", id)
          .single();

        updates.metadata = {
          ...((existing?.metadata as Record<string, unknown>) ?? {}),
          ...metadata,
        };
      }

      if (Object.keys(updates).length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No fields to update." },
          ],
        };
      }

      const { data, error } = await supabase
        .from("entries")
        .update(updates)
        .eq("id", id)
        .select("id, title, updated_at")
        .single();

      if (error) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${error.message}` },
          ],
        };
      }

      if (!data) {
        return {
          content: [
            { type: "text" as const, text: `Entry not found: ${id}` },
          ],
        };
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data, null, 2) },
        ],
      };
    }
  );

  // ── brain_delete ────────────────────────────────────────────
  server.tool(
    "brain_delete",
    "Permanently delete an entry. This cannot be undone (Supabase point-in-time recovery is the safety net).",
    {
      id: z.string().uuid().describe("Entry UUID"),
    },
    async ({ id }) => {
      const { error, count } = await supabase
        .from("entries")
        .delete({ count: "exact" })
        .eq("id", id);

      if (error) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${error.message}` },
          ],
        };
      }

      if (count === 0) {
        return {
          content: [
            { type: "text" as const, text: `Entry not found: ${id}` },
          ],
        };
      }

      return {
        content: [
          { type: "text" as const, text: `Deleted entry ${id}.` },
        ],
      };
    }
  );

  // ── brain_tag ───────────────────────────────────────────────
  server.tool(
    "brain_tag",
    "Add or remove tags from an entry. Tags are created automatically if they don't exist.",
    {
      entry_id: z.string().uuid().describe("Entry UUID"),
      add: z
        .array(z.string())
        .optional()
        .describe("Tags to add (created if new)"),
      remove: z.array(z.string()).optional().describe("Tags to remove"),
    },
    async ({ entry_id, add, remove }) => {
      // Add tags
      if (add && add.length > 0) {
        for (const tagName of add) {
          const normalized = tagName.toLowerCase().trim();

          const { data: tag } = await supabase
            .from("tags")
            .upsert({ name: normalized }, { onConflict: "name" })
            .select("id")
            .single();

          if (tag) {
            await supabase
              .from("entry_tags")
              .upsert(
                { entry_id, tag_id: tag.id },
                { onConflict: "entry_id,tag_id" }
              )
              .select();
          }
        }
      }

      // Remove tags
      if (remove && remove.length > 0) {
        for (const tagName of remove) {
          const normalized = tagName.toLowerCase().trim();

          const { data: tag } = await supabase
            .from("tags")
            .select("id")
            .eq("name", normalized)
            .single();

          if (tag) {
            await supabase
              .from("entry_tags")
              .delete()
              .eq("entry_id", entry_id)
              .eq("tag_id", tag.id);
          }
        }
      }

      // Return current tags
      const { data: currentTags } = await supabase
        .from("entry_tags")
        .select("tags(name)")
        .eq("entry_id", entry_id);

      const tagNames = (currentTags as unknown as Array<{ tags: { name: string } }> ?? []).map(
        (row) => row.tags.name
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { entry_id, tags: tagNames },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── brain_link ──────────────────────────────────────────────
  server.tool(
    "brain_link",
    `Create or remove a relationship between two entries. Relationship types: relates_to, follows_up, supports, contradicts, part_of, led_to.`,
    {
      source_id: z.string().uuid().describe("Source entry UUID"),
      target_id: z.string().uuid().describe("Target entry UUID"),
      relationship: z
        .enum(RELATIONSHIP_TYPES)
        .describe("Relationship type"),
      description: z
        .string()
        .optional()
        .describe("Context about the relationship"),
      remove: z
        .boolean()
        .optional()
        .describe("If true, removes the link instead of creating it"),
    },
    async ({ source_id, target_id, relationship, description, remove: shouldRemove }) => {
      if (shouldRemove) {
        const { error } = await supabase
          .from("entry_links")
          .delete()
          .eq("source_entry_id", source_id)
          .eq("target_entry_id", target_id)
          .eq("relationship", relationship);

        if (error) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${error.message}` },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Removed ${relationship} link from ${source_id} to ${target_id}.`,
            },
          ],
        };
      }

      const { data, error } = await supabase
        .from("entry_links")
        .upsert(
          {
            source_entry_id: source_id,
            target_entry_id: target_id,
            relationship,
            description: description ?? null,
          },
          { onConflict: "source_entry_id,target_entry_id,relationship" }
        )
        .select("id")
        .single();

      if (error) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${error.message}` },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                link_id: data?.id,
                source_id,
                target_id,
                relationship,
                description: description ?? null,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── brain_related ───────────────────────────────────────────
  server.tool(
    "brain_related",
    "Find entries related to a given entry — through explicit links AND implicit similarity (shared tags, keywords, category).",
    {
      id: z.string().uuid().describe("Entry UUID"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results (default: 10)"),
    },
    async ({ id, limit }) => {
      const { data, error } = await supabase.rpc("find_related_entries", {
        entry_uuid: id,
        max_results: limit ?? 10,
      });

      if (error) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${error.message}` },
          ],
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No related entries found for ${id}.`,
            },
          ],
        };
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data, null, 2) },
        ],
      };
    }
  );

  // ── brain_categories ────────────────────────────────────────
  server.tool(
    "brain_categories",
    "List all categories with their descriptions and entry counts. Useful for understanding what's in the brain and picking a category for brain_save.",
    {},
    async () => {
      const { data, error } = await supabase.rpc(
        "list_categories_with_counts"
      );

      if (error) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${error.message}` },
          ],
        };
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data, null, 2) },
        ],
      };
    }
  );
}
