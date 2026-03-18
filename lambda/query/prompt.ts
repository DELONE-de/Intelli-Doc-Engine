export interface PromptContext {
  question: string;
  context:  string;
}

export function buildRagPrompt({ question, context }: PromptContext): string {
  return `You are a helpful assistant. Answer the user's question using ONLY the information provided in the context below.

Rules:
- If the answer is not found in the context, respond with: "I don't have enough information to answer that question."
- Do not use any prior knowledge or make assumptions beyond what is in the context.
- Be concise and accurate.
- Cite the source chunk IDs where relevant.

Context:
${context}

Question: ${question}

Answer:`;
}
