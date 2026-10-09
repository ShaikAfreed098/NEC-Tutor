import path from "node:path";
import { availableParallelism } from "node:os";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { DATA_DIR } from "./local-store";
import { normalizeVector } from "./retrieval";

// Keep documents and questions in exactly the same 768-dimensional vector space.
export const EMBEDDING_MODEL = "Xenova/all-mpnet-base-v2";
const REVISION = "dd96b5e5e6c64d6759db1163c8b3190351710860";
export const EMBEDDING_VERSION = `${EMBEDDING_MODEL}:${REVISION}:q8:mean:768`;
const state = globalThis as typeof globalThis & { necExtractor?: Promise<FeatureExtractionPipeline>; necEmbeddingQueue?: Promise<unknown> };

function extractor() {
  if (!state.necExtractor) {
    state.necExtractor = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = path.join(DATA_DIR, "models");
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      // Only model files are downloaded. Course text is processed on this CPU.
      const model = await pipeline("feature-extraction", EMBEDDING_MODEL, {
        revision: REVISION, dtype: "q8", device: "cpu",
        session_options: { intraOpNumThreads: Math.min(4, availableParallelism()) }
      });
      env.allowRemoteModels = false;
      return model;
    })().catch(error => { state.necExtractor = undefined; throw error; });
  }
  return state.necExtractor;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const run = async () => {
    const model = await extractor();
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += 2) {
      const output = await model(texts.slice(i, i + 2), { pooling: "mean", normalize: true });
      const batch = output.tolist() as number[][];
      if (batch.length !== texts.slice(i, i + 2).length || batch.some(v => v.length !== 768)) throw new Error("Local search returned an unexpected embedding size.");
      vectors.push(...batch.map(normalizeVector));
    }
    return vectors;
  };
  const pending = (state.necEmbeddingQueue || Promise.resolve()).then(run, run);
  state.necEmbeddingQueue = pending.catch(() => {});
  return pending;
}
