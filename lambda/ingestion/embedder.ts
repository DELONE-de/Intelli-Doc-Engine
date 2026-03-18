import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DocumentChunk } from './chunker';

const bedrock   = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const MODEL_ID  = 'amazon.titan-embed-text-v2:0';
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;

export interface EmbeddedChunk {
  chunkId:    string;
  embedding:  number[];
  text:       string;
  metadata: {
    documentId: string;
    pageNumber: number;
  };
}

async function embedWithRetry(text: string, attempt = 0): Promise<number[]> {
  try {
    const response = await bedrock.send(new InvokeModelCommand({
      modelId:     MODEL_ID,
      contentType: 'application/json',
      accept:      'application/json',
      body:        JSON.stringify({ inputText: text }),
    }));

    const result = JSON.parse(Buffer.from(response.body).toString('utf-8'));
    return result.embedding as number[];
  } catch (err: any) {
    if (attempt < MAX_RETRIES) {
      const delay = 200 * Math.pow(2, attempt); // exponential backoff
      console.warn(`[embedder] Retry ${attempt + 1}/${MAX_RETRIES} for chunk after ${delay}ms — ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
      return embedWithRetry(text, attempt + 1);
    }
    throw new Error(`[embedder] Failed after ${MAX_RETRIES} retries: ${err.message}`);
  }
}

export async function embedChunks(chunks: DocumentChunk[]): Promise<EmbeddedChunk[]> {
  const results: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    const embedded = await Promise.all(
      batch.map(async chunk => {
        const embedding = await embedWithRetry(chunk.text);
        return {
          chunkId:   chunk.chunkId,
          embedding,
          text:      chunk.text,
          metadata: {
            documentId: chunk.documentId,
            pageNumber: chunk.pageNumber,
          },
        } satisfies EmbeddedChunk;
      })
    );

    results.push(...embedded);
    console.log(`[embedder] Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (${embedded.length} chunks)`);
  }

  return results;
}
