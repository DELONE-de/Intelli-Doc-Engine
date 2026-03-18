import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { RetrievedChunk } from './retriever';
import { buildRagPrompt } from './prompt';

const bedrock  = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';

export interface GeneratorInput {
  question: string;
  chunks:   RetrievedChunk[];
}

export interface GeneratorOutput {
  answer:     string;
  inputTokens:  number;
  outputTokens: number;
}

export async function generateAnswer({ question, chunks }: GeneratorInput): Promise<GeneratorOutput> {
  const context = chunks
    .map((c, i) => `[${i + 1}] (chunkId: ${c.metadata.chunkId}, page: ${c.metadata.pageNumber})\n${c.text}`)
    .join('\n\n');

  const prompt = buildRagPrompt({ question, context });

  const response = await bedrock.send(new InvokeModelCommand({
    modelId:     MODEL_ID,
    contentType: 'application/json',
    accept:      'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens:        1024,
      temperature:       0.2, // low temperature for factual RAG responses
      messages: [{ role: 'user', content: prompt }],
    }),
  }));

  const result = JSON.parse(Buffer.from(response.body).toString('utf-8'));
  const answer = result.content?.[0]?.text ?? '';

  console.log(`[generator] Answer generated — input_tokens: ${result.usage?.input_tokens}, output_tokens: ${result.usage?.output_tokens}`);

  return {
    answer,
    inputTokens:  result.usage?.input_tokens  ?? 0,
    outputTokens: result.usage?.output_tokens ?? 0,
  };
}
