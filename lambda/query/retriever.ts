import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Client }           from '@opensearch-project/opensearch';
import { AwsSigv4Signer }   from '@opensearch-project/opensearch/aws';

const ENDPOINT = process.env.COLLECTION_ENDPOINT!;
const REGION   = process.env.AWS_REGION!;
const TOP_K    = 5;

export interface RetrievedChunk {
  text:     string;
  score:    number;
  metadata: {
    documentId: string;
    pageNumber: number;
    chunkId:    string;
  };
}

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

export async function retrieveChunks(embedding: number[], question: string): Promise<RetrievedChunk[]> {
  const client = getClient();

  // Hybrid search: kNN vector similarity + keyword match
  const { body } = await client.search({
    index: 'vector',
    body: {
      size: TOP_K,
      query: {
        hybrid: {
          queries: [
            {
              knn: {
                embedding: {
                  vector: embedding,
                  k:      TOP_K,
                },
              },
            },
            {
              match: {
                content: {
                  query: question,
                  boost: 0.3,
                },
              },
            },
          ],
        },
      },
      _source: ['document_id', 'chunk_id'],
    },
  });

  const hits: any[] = body.hits?.hits ?? [];

  if (hits.length === 0) {
    console.warn('[retriever] No results found');
    return [];
  }

  // Fetch full text for each hit from the text index
  const chunkIds: string[] = hits.map((h: any) => h._source.chunk_id);

  const { body: textBody } = await client.search({
    index: 'text',
    body: {
      size: TOP_K,
      query: { ids: { values: chunkIds } },
      _source: ['document_id', 'chunk_id', 'content', 'page'],
    },
  });

  const textMap = new Map<string, any>(
    (textBody.hits?.hits ?? []).map((h: any) => [h._id, h._source])
  );

  const results: RetrievedChunk[] = hits.map((hit: any) => {
    const chunkId  = hit._source.chunk_id;
    const textDoc  = textMap.get(chunkId) ?? {};
    return {
      text:  textDoc.content ?? '',
      score: hit._score,
      metadata: {
        documentId: hit._source.document_id ?? textDoc.document_id ?? '',
        pageNumber: textDoc.page ?? 0,
        chunkId,
      },
    };
  });

  console.log(`[retriever] Retrieved ${results.length} chunks for query`);
  return results;
}
