import { SQSRecord } from 'aws-lambda';

const CHUNK_SIZE = 700;
const OVERLAP    = 100;

export interface TextractSQSMessage {
  bucket:      string;
  key:         string;
  chunkIndex:  number;
  totalChunks: number;
  text:        string;
}

export interface DocumentChunk {
  documentId:  string;
  pageNumber:  number;
  chunkId:     string;
  text:        string;
}

// In-memory buffer for reassembling multi-part Textract messages within a batch
const partBuffer = new Map<string, { parts: string[]; total: number; bucket: string; key: string }>();

function buildDocumentId(bucket: string, key: string): string {
  return `${bucket}::${key}`;
}

function splitIntoChunks(text: string, documentId: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let start      = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    const end      = Math.min(start + CHUNK_SIZE, text.length);
    const chunkText = text.slice(start, end).trim();

    if (chunkText.length > 0) {
      chunks.push({
        documentId,
        pageNumber: Math.floor(chunkIndex / 10) + 1, // estimate page from chunk position
        chunkId:    `${documentId}#chunk-${chunkIndex}`,
        text:       chunkText,
      });
      chunkIndex++;
    }

    if (end === text.length) break;
    start += CHUNK_SIZE - OVERLAP;
  }

  return chunks;
}

export function processRecord(record: SQSRecord): DocumentChunk[] | null {
  const msg: TextractSQSMessage = JSON.parse(record.body);
  const { bucket, key, chunkIndex, totalChunks, text } = msg;
  const documentId = buildDocumentId(bucket, key);

  if (totalChunks === 1) {
    const chunks = splitIntoChunks(text, documentId);
    console.log(`[chunker] ${key} → single part → ${chunks.length} chunks`);
    return chunks;
  }

  // Multi-part reassembly
  if (!partBuffer.has(documentId)) {
    partBuffer.set(documentId, { parts: new Array(totalChunks).fill(''), total: totalChunks, bucket, key });
  }

  const entry    = partBuffer.get(documentId)!;
  entry.parts[chunkIndex] = text;

  const received = entry.parts.filter(p => p.length > 0).length;
  console.log(`[chunker] ${key} part ${chunkIndex + 1}/${totalChunks} (${received}/${totalChunks} received)`);

  if (received === totalChunks) {
    const fullText = entry.parts.join('');
    partBuffer.delete(documentId);
    const chunks = splitIntoChunks(fullText, documentId);
    console.log(`[chunker] ${key} reassembled → ${chunks.length} chunks (size=${CHUNK_SIZE}, overlap=${OVERLAP})`);
    return chunks;
  }

  return null; // still waiting for remaining parts
}
