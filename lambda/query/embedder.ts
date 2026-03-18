import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock  = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const MODEL_ID = 'amazon.titan-embed-text-v2:0';

export interface QueryEmbedding {
  embedding: number[];
}

export async function embedQuery(question: string): Promise<QueryEmbedding> {
  const response = await bedrock.send(new InvokeModelCommand({
    modelId:     MODEL_ID,
    contentType: 'application/json',
    accept:      'application/json',
    body:        JSON.stringify({ inputText: question }),
  }));

  const result = JSON.parse(Buffer.from(response.body).toString('utf-8'));
  console.log(`[embedder] Query embedded — vector dim: ${result.embedding.length}`);

  return { embedding: result.embedding as number[] };
}
