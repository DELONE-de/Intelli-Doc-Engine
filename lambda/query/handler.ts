import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

export const handler = async (event: any) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body ?? {};
    const queryParams = event.queryParams ?? {};
    const pathParams = event.pathParams ?? {};
    const headers = event.headers ?? {};

    const prompt = body.prompt ?? body.query ?? queryParams.prompt ?? '';

    if (!prompt) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required field: prompt or query' }),
      };
    }

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    };

    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    const response = await bedrock.send(command);
    const result = JSON.parse(Buffer.from(response.body).toString('utf-8'));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generated: result.content?.[0]?.text ?? '',
        model: result.model,
        usage: result.usage,
        receivedParams: { body, queryParams, pathParams },
      }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
