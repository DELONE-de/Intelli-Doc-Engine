import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { embedQuery }                    from './embedder';
import { retrieveChunks, RetrievedChunk } from './retriever';
import { generateAnswer }                from './generator';

interface QueryRequest {
  question: string;
}

interface QueryResponse {
  answer:  string;
  sources: RetrievedChunk['metadata'][];
}

function respond(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // ── 1. Parse & validate ───────────────────────────────────────────────
    const body: Partial<QueryRequest> = event.body
      ? JSON.parse(event.body)
      : {};

    if (!body.question?.trim()) {
      return respond(400, { error: 'Missing required field: question' });
    }

    const { question } = body as QueryRequest;
    console.log(`[handler] Question: "${question}"`);

    // ── 2. Embed query ────────────────────────────────────────────────────
    const { embedding } = await embedQuery(question);

    // ── 3. Retrieve relevant chunks ───────────────────────────────────────
    const chunks = await retrieveChunks(embedding, question);

    if (chunks.length === 0) {
      return respond(200, {
        answer:  "I don't have enough information to answer that question.",
        sources: [],
      } satisfies QueryResponse);
    }

    // ── 4. Generate answer ────────────────────────────────────────────────
    const { answer, inputTokens, outputTokens } = await generateAnswer({ question, chunks });
    console.log(`[handler] Answer generated (${answer.length} chars, tokens: ${inputTokens}in/${outputTokens}out)`);

    return respond(200, {
      answer,
      sources: chunks.map(c => c.metadata),
    } satisfies QueryResponse);

  } catch (err: any) {
    console.error('[handler] Error:', err.message, err.stack);
    return respond(500, { error: 'Internal server error' });
  }
};
