# Intelli-Doc-Engine

A fully serverless AI-powered document Q&A engine built on AWS. Upload any document and ask questions about it in plain English — answers are grounded strictly in your documents using Retrieval-Augmented Generation (RAG).

---

## Architecture Overview

```
                        ┌─────────────────────────────────────────────────────┐
                        │                  INGESTION PIPELINE                  │
                        │                                                       │
  Upload Document       │   S3 Bucket                                          │
  ─────────────────►    │      │                                               │
                        │      │ EventBridge (Object Created)                  │
                        │      ▼                                               │
                        │   Ingestion Lambda                                   │
                        │      │ Amazon Textract (extract text)                │
                        │      ▼                                               │
                        │   SQS Extraction Queue                               │
                        │      │                                               │
                        │      │ SQS Trigger                                   │
                        │      ▼                                               │
                        │   Ingestion Lambda (chunker → embedder → indexer)   │
                        │      │ Bedrock Titan Embed v2 (embeddings)           │
                        │      ▼                                               │
                        │   OpenSearch Serverless                              │
                        │   ├── vector   (kNN embeddings)                      │
                        │   ├── text     (raw chunks)                          │
                        │   └── metadata (document info)                       │
                        └─────────────────────────────────────────────────────┘

                        ┌─────────────────────────────────────────────────────┐
                        │                   QUERY PIPELINE                     │
                        │                                                       │
  POST /query           │   API Gateway                                        │
  { "question": "..." } │      │                                               │
  ─────────────────►    │      ▼                                               │
                        │   Query Lambda                                       │
                        │      │ Bedrock Titan Embed v2 (embed question)       │
                        │      │ OpenSearch hybrid search (kNN + keyword)      │
                        │      │ Bedrock Claude 3 Sonnet (generate answer)     │
                        │      ▼                                               │
  ◄─────────────────    │   { answer, sources }                                │
                        └─────────────────────────────────────────────────────┘
```

---

## Project Structure

```
Intelli-Doc-Engine/
├── bin/
│   └── app.ts                  # CDK app entry point
├── lambda/
│   ├── ingestion/
│   │   ├── handler.ts          # Lambda entry — orchestrates ingestion pipeline
│   │   ├── textract.ts         # Extracts text from S3 docs via Amazon Textract
│   │   ├── chunker.ts          # Splits text into 700-char chunks (100 overlap)
│   │   ├── embedder.ts         # Generates Titan v2 embeddings per chunk
│   │   └── indexer.ts          # Bulk indexes into OpenSearch (vector/text/metadata)
│   └── query/
│       ├── handler.ts          # Lambda entry — orchestrates query pipeline
│       ├── embedder.ts         # Embeds user question via Titan v2
│       ├── retriever.ts        # Hybrid kNN + keyword search on OpenSearch
│       ├── generator.ts        # Calls Claude 3 Sonnet with RAG prompt
│       └── prompt.ts           # RAG prompt template (context-only rules)
├── lib/
│   ├── constructs/
│   │   ├── opensearch-vector.ts  # OpenSearch Serverless collection + policies
│   │   ├── ingestion-lambda.ts   # Ingestion Lambda construct
│   │   ├── query-lambda.ts       # Query Lambda construct
│   │   └── api-gateway.ts        # REST API Gateway with POST /query
│   ├── stacks/
│   │   ├── base-infra-stack.ts   # S3, SQS, IAM roles, OpenSearch
│   │   ├── ingestion-stack.ts    # Ingestion Lambda + EventBridge S3 trigger
│   │   ├── query-stack.ts        # Query Lambda + API Gateway
│   │   └── monitoring-stack.ts   # CloudWatch dashboard + alarms
│   └── my-first-stack.ts         # Wires all stacks together
├── scripts/
│   └── create-index.sh           # Creates OpenSearch indexes after deploy
├── .github/
│   └── workflows/
│       └── cdk-synth.yml         # GitHub Actions — CDK synth on push/PR
└── .env                          # Local environment variables (not committed)
```

---

## AWS Services Used

| Service | Purpose |
|---|---|
| Amazon S3 | Document storage |
| Amazon Textract | Text extraction from PDFs, images, Word docs |
| Amazon SQS | Decouples ingestion for high-volume traffic |
| AWS Lambda | Ingestion and query compute |
| Amazon Bedrock (Titan Embed v2) | Generates vector embeddings |
| Amazon Bedrock (Claude 3 Sonnet) | Generates grounded answers |
| Amazon OpenSearch Serverless | Vector + full-text search |
| Amazon API Gateway | REST API endpoint |
| Amazon CloudWatch | Monitoring, dashboards, and alarms |
| Amazon SNS | Alarm notifications |
| AWS CDK | Infrastructure as code |

---

## Prerequisites

- Node.js 20+
- AWS CLI configured
- AWS CDK v2 installed (`npm install -g aws-cdk`)
- AWS account with Bedrock model access enabled:
  - `amazon.titan-embed-text-v2:0`
  - `anthropic.claude-3-sonnet-20240229-v1:0`

---

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/Intelli-Doc-Engine.git
cd Intelli-Doc-Engine
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```bash
CDK_DEFAULT_ACCOUNT=<your-aws-account-id>
CDK_DEFAULT_REGION=us-east-1
ALARM_EMAIL=your@email.com   # optional — receive CloudWatch alarm emails
```

### 3. Bootstrap CDK

```bash
source .env && cdk bootstrap
```

### 4. Deploy all stacks

```bash
source .env && cdk deploy --all
```

Stacks deploy in order:
1. `BaseInfraStack` — S3, SQS, IAM, OpenSearch
2. `IngestionStack` — Ingestion Lambda + EventBridge trigger
3. `QueryStack` — Query Lambda + API Gateway
4. `MonitoringStack` — CloudWatch dashboard + alarms

### 5. Create OpenSearch indexes

Run after `BaseInfraStack` is deployed:

```bash
bash scripts/create-index.sh
```

This creates 3 indexes in the OpenSearch collection:
- `vector` — stores kNN embeddings
- `text` — stores raw document chunks
- `metadata` — stores document-level info

---

## Usage

### Upload a document

```bash
aws s3 cp my-document.pdf s3://intelli-doc-uploads-<account-id>/
```

Supported formats: PDF, PNG, JPG, TIFF, Word (.docx), plain text

### Ask a question

```bash
curl -X POST https://<api-id>.execute-api.us-east-1.amazonaws.com/prod/query \
  -H "Content-Type: application/json" \
  -d '{ "question": "What are the key findings in the report?" }'
```

Response:
```json
{
  "answer": "Based on the documents, the key findings are...",
  "sources": [
    { "documentId": "my-bucket::my-document.pdf", "pageNumber": 2, "chunkId": "...#chunk-4" }
  ]
}
```

---

## Document Update Support

Re-uploading a file to S3 with the same key automatically:
1. Deletes all existing chunks for that document from OpenSearch
2. Re-extracts, re-chunks, re-embeds, and re-indexes the new content

No manual intervention needed.

---

## Monitoring

A CloudWatch dashboard `IntelliDoc-Engine` is deployed with:
- Ingestion Lambda — invocations, errors, p50/p99 duration
- Query Lambda — invocations, errors, p50/p99 duration
- Bedrock — invocations, errors, p50/p99 latency

Alarms trigger SNS notifications for:
- Lambda errors ≥ 5 in 10 minutes
- Lambda throttles ≥ 10 in 5 minutes
- Lambda p99 duration ≥ 80% of timeout
- Bedrock errors ≥ 5 in 10 minutes
- Bedrock p99 latency ≥ 10 seconds
- Bedrock throttles ≥ 3 in 5 minutes

---

## CI/CD

GitHub Actions runs `cdk synth --all` on every push and PR to `main` to validate the infrastructure without deploying.

Add these secrets to your GitHub repo (**Settings → Secrets → Actions**):

| Secret | Description |
|---|---|
| `CDK_DEFAULT_ACCOUNT` | AWS account ID |
| `CDK_DEFAULT_REGION` | AWS region |
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |

---

## Chunking Configuration

| Parameter | Value |
|---|---|
| Chunk size | 700 characters |
| Overlap | 100 characters |
| Embedding model | amazon.titan-embed-text-v2:0 (1536 dimensions) |
| Search top-k | 5 results |

---

## License

MIT
