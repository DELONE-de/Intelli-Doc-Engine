import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Client }           from '@opensearch-project/opensearch';
import { AwsSigv4Signer }   from '@opensearch-project/opensearch/aws';
import { EmbeddedChunk }    from './embedder';

const ENDPOINT    = process.env.COLLECTION_ENDPOINT!;
const REGION      = process.env.AWS_REGION!;
const BULK_SIZE   = 25;
const MAX_RETRIES = 3;
const ALL_INDEXES = ['vector', 'text', 'metadata'] as const;

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    _client = new Client({
      ...AwsSigv4Signer({ region: REGION, service: 'aoss', getCredentials: defaultProvider() }),
      node: ENDPOINT.startsWith('https') ? ENDPOINT : `https://${ENDPOINT}`,
    });
  }
  return _client;
}

interface BulkError { index: string; id: string; reason: string }

async function bulkIndex(operations: object[], attempt = 0): Promise<BulkError[]> {
  try {
    const { body } = await getClient().bulk({ body: operations, refresh: false });
    if (!body.errors) return [];
    return (body.items as any[])
      .filter(item => item.index?.error)
      .map(item => ({ index: item.index._index, id: item.index._id, reason: item.index.error.reason }));
  } catch (err: any) {
    if (attempt < MAX_RETRIES) {
      const delay = 300 * Math.pow(2, attempt);
      console.warn(`[indexer] Bulk retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms — ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
      return bulkIndex(operations, attempt + 1);
    }
    throw new Error(`[indexer] Bulk index failed after ${MAX_RETRIES} retries: ${err.message}`);
  }
}

// Delete all chunks for a documentId across all 3 indexes before re-indexing
export async function deleteDocumentChunks(documentId: string): Promise<void> {
  await Promise.all(ALL_INDEXES.map(async index => {
    try {
      const { body } = await getClient().deleteByQuery({
        index,
        refresh: true,
        body: { query: { term: { document_id: documentId } } },
      }) as any;
      const deleted = body?.deleted ?? 0;
      if (deleted > 0) {
        console.log(`[indexer] Deleted ${deleted} docs from '${index}' for: ${documentId}`);
      }
    } catch (err: any) {
      if (err?.meta?.statusCode !== 404) {
        console.warn(`[indexer] deleteByQuery failed on '${index}': ${err.message}`);
      }
    }
  }));
}

export async function indexChunks(chunks: EmbeddedChunk[]): Promise<void> {
  for (let i = 0; i < chunks.length; i += BULK_SIZE) {
    const batch      = chunks.slice(i, i + BULK_SIZE);
    const operations: object[] = [];

    for (const chunk of batch) {
      const { chunkId, embedding, text, metadata } = chunk;

      operations.push(
        { index: { _index: 'vector', _id: chunkId } },
        { document_id: metadata.documentId, chunk_id: chunkId, embedding },
      );

      operations.push(
        { index: { _index: 'text', _id: chunkId } },
        { document_id: metadata.documentId, chunk_id: chunkId, content: text, page: metadata.pageNumber, timestamp: new Date().toISOString() },
      );

      operations.push(
        { index: { _index: 'metadata', _id: metadata.documentId } },
        { document_id: metadata.documentId, source: 's3', uploaded_at: new Date().toISOString() },
      );
    }

    const errors = await bulkIndex(operations);
    if (errors.length > 0) {
      console.error(`[indexer] ${errors.length} bulk errors in batch ${Math.floor(i / BULK_SIZE) + 1}:`, JSON.stringify(errors));
    }
    console.log(`[indexer] Indexed batch ${Math.floor(i / BULK_SIZE) + 1}/${Math.ceil(chunks.length / BULK_SIZE)} (${batch.length} chunks)`);
  }
}
