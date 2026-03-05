import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("Missing OPENAI_API_KEY environment variable");
}

const openai = new OpenAI({ apiKey });

export function buildEmbeddingText(
  title: string,
  summary?: string | null,
  keywords?: string[],
  content?: string
): string {
  return [title, summary, keywords?.join(" "), content?.slice(0, 8000)]
    .filter(Boolean)
    .join("\n");
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  } catch (err) {
    console.error("Embedding generation failed:", err);
    return null;
  }
}
