#!/bin/bash
set -e

COLLECTION_NAME="intelli-doc-vectors"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

# Fetch collection endpoint
ENDPOINT=$(aws opensearchserverless list-collections \
  --query "collectionSummaries[?name=='${COLLECTION_NAME}'].collectionEndpoint" \
  --output text \
  --region "$REGION")

if [ -z "$ENDPOINT" ]; then
  echo "Error: Could not find collection endpoint for '${COLLECTION_NAME}'"
  exit 1
fi

echo "Using endpoint: $ENDPOINT"

create_index() {
  local INDEX_NAME=$1
  local BODY=$2

  echo ""
  echo "Creating index '${INDEX_NAME}'..."

  HTTP_CODE=$(curl -s -o /tmp/os_response.json -w "%{http_code}" \
    --aws-sigv4 "aws:amz:${REGION}:aoss" \
    --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
    -H "x-amz-security-token: ${AWS_SESSION_TOKEN}" \
    -H "Content-Type: application/json" \
    -X PUT "${ENDPOINT}/${INDEX_NAME}" \
    -d "$BODY")

  cat /tmp/os_response.json
  echo ""

  if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 201 ]; then
    echo "✓ Index '${INDEX_NAME}' created (HTTP $HTTP_CODE)"
  else
    echo "✗ Failed to create index '${INDEX_NAME}' (HTTP $HTTP_CODE)"
    exit 1
  fi
}

# ── vector index ─────────────────────────────────────────────────────────────
create_index "vector" '{
  "settings": { "index.knn": true },
  "mappings": {
    "properties": {
      "document_id": { "type": "keyword" },
      "chunk_id":    { "type": "keyword" },
      "embedding": {
        "type": "knn_vector",
        "dimension": 1536,
        "method": {
          "name": "hnsw",
          "engine": "faiss",
          "space_type": "l2"
        }
      }
    }
  }
}'

# ── text index ────────────────────────────────────────────────────────────────
create_index "text" '{
  "settings": { "index.knn": false },
  "mappings": {
    "properties": {
      "document_id": { "type": "keyword" },
      "chunk_id":    { "type": "keyword" },
      "content":     { "type": "text" },
      "page":        { "type": "integer" },
      "timestamp":   { "type": "date" }
    }
  }
}'

# ── metadata index ────────────────────────────────────────────────────────────
create_index "metadata" '{
  "settings": { "index.knn": false },
  "mappings": {
    "properties": {
      "document_id":  { "type": "keyword" },
      "source":       { "type": "keyword" },
      "file_name":    { "type": "keyword" },
      "file_type":    { "type": "keyword" },
      "s3_key":       { "type": "keyword" },
      "uploaded_at":  { "type": "date" },
      "page_count":   { "type": "integer" },
      "tags":         { "type": "keyword" }
    }
  }
}'

echo ""
echo "All indexes created successfully."
