import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { processRecord } from './chunker';
import { embedChunks }   from './embedder';
import { indexChunks, deleteDocumentChunks } from './indexer';

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: SQSBatchItemFailure[] = [];

  await Promise.all(
    event.Records.map(async record => {
      const { messageId } = record;
      try {
        // ── 1. Chunk ──────────────────────────────────────────────────────
        const chunks = processRecord(record);

        if (!chunks || chunks.length === 0) {
          console.log(`[handler] ${messageId} — no chunks produced (multi-part pending), skipping`);
          return;
        }

        console.log(`[handler] ${messageId} — ${chunks.length} chunks produced`);

        // ── 2. Delete existing chunks (handles re-uploads / updates) ──────
        const documentId = chunks[0].documentId;
        await deleteDocumentChunks(documentId);
        console.log(`[handler] ${messageId} — old chunks cleared for: ${documentId}`);

        // ── 3. Embed ──────────────────────────────────────────────────────
        const embedded = await embedChunks(chunks);
        console.log(`[handler] ${messageId} — ${embedded.length} embeddings generated`);

        // ── 4. Index ──────────────────────────────────────────────────────
        await indexChunks(embedded);
        console.log(`[handler] ${messageId} — indexed successfully`);

      } catch (err: any) {
        console.error(`[handler] ${messageId} — FAILED: ${err.message}`, err.stack);
        failures.push({ itemIdentifier: messageId });
      }
    })
  );

  if (failures.length > 0) {
    console.warn(`[handler] ${failures.length}/${event.Records.length} messages failed — returning for retry`);
  }

  return { batchItemFailures: failures };
};
