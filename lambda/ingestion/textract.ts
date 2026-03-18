import { TextractClient, StartDocumentTextDetectionCommand, GetDocumentTextDetectionCommand } from '@aws-sdk/client-textract';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const textract = new TextractClient({ region: process.env.AWS_REGION });
const sqs      = new SQSClient({ region: process.env.AWS_REGION });

const QUEUE_URL = process.env.SQS_QUEUE_URL!;
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 24; // 2 minutes max

async function waitForJob(jobId: string): Promise<string[]> {
  for (let i = 0; i < MAX_POLLS; i++) {
    const result = await textract.send(new GetDocumentTextDetectionCommand({ JobId: jobId }));

    if (result.JobStatus === 'FAILED') throw new Error(`Textract job ${jobId} failed`);

    if (result.JobStatus === 'SUCCEEDED') {
      const lines: string[] = [];
      let nextToken = result.NextToken;

      (result.Blocks ?? []).forEach(b => {
        if (b.BlockType === 'LINE' && b.Text) lines.push(b.Text);
      });

      while (nextToken) {
        const page = await textract.send(new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken }));
        (page.Blocks ?? []).forEach(b => {
          if (b.BlockType === 'LINE' && b.Text) lines.push(b.Text);
        });
        nextToken = page.NextToken;
      }

      return lines;
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Textract job ${jobId} timed out`);
}

export async function extractTextFromDocument(bucket: string, key: string): Promise<void> {
  // Start async Textract job
  const { JobId } = await textract.send(new StartDocumentTextDetectionCommand({
    DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
  }));

  if (!JobId) throw new Error('Textract did not return a JobId');

  // Poll until complete
  const lines = await waitForJob(JobId);
  const extractedText = lines.join('\n');

  // Send extracted text to SQS in chunks of 250KB to stay under 256KB limit
  const CHUNK_SIZE = 250_000;
  const chunks = Math.ceil(extractedText.length / CHUNK_SIZE);

  for (let i = 0; i < chunks; i++) {
    const chunk = extractedText.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);

    await sqs.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        bucket,
        key,
        chunkIndex: i,
        totalChunks: chunks,
        text: chunk,
      }),
      MessageAttributes: {
        documentKey: { DataType: 'String', StringValue: key },
        chunkIndex:  { DataType: 'Number', StringValue: String(i) },
      },
    }));
  }

  console.log(`Extracted ${lines.length} lines from s3://${bucket}/${key} → sent ${chunks} SQS message(s)`);
}
