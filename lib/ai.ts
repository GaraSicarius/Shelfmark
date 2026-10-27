import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embedMany, type LanguageModel } from "ai";

// Two providers: Gemini when a Google API key is set, otherwise the Vercel
// AI Gateway (key or OIDC). Gemini gets provider-native embedding options;
// the gateway path keeps plain string model ids.
const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const GATEWAY_EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBED_BATCH = 64;

function geminiKey(): string | undefined {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
}

export function aiConfigured(): boolean {
  return !!(
    geminiKey() ||
    process.env.AI_GATEWAY_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN
  );
}

export function chatModel(): LanguageModel | string {
  if (geminiKey()) {
    return createGoogleGenerativeAI({ apiKey: geminiKey() })(
      process.env.AI_MODEL ?? "gemini-3.5-flash-lite",
    );
  }
  return process.env.AI_MODEL ?? "openai/gpt-5.4-mini";
}

export type EmbeddingTask = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

// Returns null when no AI key is configured, so callers can index
// keyword-only. Throws on API errors; callers degrade to keyword-only.
export async function embedTexts(
  texts: string[],
  task: EmbeddingTask = "RETRIEVAL_DOCUMENT",
): Promise<number[][] | null> {
  if (!aiConfigured() || texts.length === 0) return null;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const values = texts.slice(i, i + EMBED_BATCH);
    const { embeddings } = geminiKey()
      ? await embedMany({
          model: createGoogleGenerativeAI({ apiKey: geminiKey() }).embeddingModel(
            GEMINI_EMBEDDING_MODEL,
          ),
          values,
          providerOptions: {
            google: { outputDimensionality: 1536, taskType: task },
          },
        })
      : await embedMany({ model: GATEWAY_EMBEDDING_MODEL, values });
    out.push(...embeddings);
  }
  return out;
}
