import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { processRecord } from './chunker';
import { embedChunks }   from './embedder';
import { indexChunks }   from './indexer';

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

        // ── 2. Embed ──────────────────────────────────────────────────────
        const embedded = await embedChunks(chunks);
        console.log(`[handler] ${messageId} — ${embedded.length} embeddings generated`);

        // ── 3. Index ──────────────────────────────────────────────────────
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

  // Returning batchItemFailures lets SQS retry only failed messages
  return { batchItemFailures: failures };
};
