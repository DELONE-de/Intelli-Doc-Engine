#!/bin/bash
set -e

COLLECTION_NAME="intelli-doc-vectors"
INDEX_NAME="documents"
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

echo "Creating index '${INDEX_NAME}' on ${ENDPOINT}..."

curl --aws-sigv4 "aws:amz:${REGION}:aoss" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -H "x-amz-security-token: ${AWS_SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -X PUT "${ENDPOINT}/${INDEX_NAME}" \
  -d '{
    "settings": {
      "index.knn": true
    },
    "mappings": {
      "properties": {
        "document_id":  { "type": "keyword" },
        "content":      { "type": "text" },
        "source":       { "type": "keyword" },
        "timestamp":    { "type": "date" },
        "embedding": {
          "type": "knn_vector",
          "dimension": 1536,
          "method": {
            "name":       "hnsw",
            "engine":     "faiss",
            "space_type": "l2"
          }
        }
      }
    }
  }'

echo ""
echo "Index '${INDEX_NAME}' created successfully."
