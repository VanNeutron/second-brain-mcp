import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { buildEmbeddingText, generateEmbedding } from "../src/embeddings.js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BATCH_SIZE = 10;

async function backfill() {
  console.log("Fetching entries without embeddings...");

  const { data: entries, error } = await supabase
    .from("entries")
    .select("id, title, summary, keywords, content")
    .is("embedding", null);

  if (error) {
    console.error("Failed to fetch entries:", error.message);
    process.exit(1);
  }

  if (!entries || entries.length === 0) {
    console.log("All entries already have embeddings.");
    return;
  }

  console.log(`Found ${entries.length} entries to process.\n`);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (entry) => {
        const text = buildEmbeddingText(
          entry.title,
          entry.summary,
          entry.keywords as string[],
          entry.content
        );

        const embedding = await generateEmbedding(text);

        if (!embedding) {
          console.error(`  ✗ ${entry.id} — ${entry.title}`);
          failed++;
          return;
        }

        const { error: updateErr } = await supabase
          .from("entries")
          .update({ embedding: `[${embedding.join(",")}]` })
          .eq("id", entry.id);

        if (updateErr) {
          console.error(`  ✗ ${entry.id} — ${entry.title}: ${updateErr.message}`);
          failed++;
        } else {
          console.log(`  ✓ ${entry.title}`);
          succeeded++;
        }
      })
    );

    // Brief pause between batches to respect rate limits
    if (i + BATCH_SIZE < entries.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
}

backfill().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
