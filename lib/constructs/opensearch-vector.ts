import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import { Construct } from 'constructs';

const COLLECTION_NAME = 'intelli-doc-vectors';

export const INDEX = {
  VECTOR:   'vector',
  TEXT:     'text',
  METADATA: 'metadata',
} as const;

interface OpenSearchVectorProps {
  ingestionRole: iam.Role;
  queryRole: iam.Role;
}

export class OpenSearchVector extends Construct {
  public readonly collectionEndpoint: string;
  public readonly collectionArn: string;

  constructor(scope: Construct, id: string, props: OpenSearchVectorProps) {
    super(scope, id);

    const { ingestionRole, queryRole } = props;
    const accountId = cdk.Stack.of(this).account;

    // Encryption policy (required)
    new opensearchserverless.CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: `${COLLECTION_NAME}-enc`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [{ ResourceType: 'collection', Resource: [`collection/${COLLECTION_NAME}`] }],
        AWSOwnedKey: true,
      }),
    });

    // Network policy (required)
    new opensearchserverless.CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: `${COLLECTION_NAME}-net`,
      type: 'network',
      policy: JSON.stringify([{
        Rules: [
          { ResourceType: 'collection', Resource: [`collection/${COLLECTION_NAME}`] },
          { ResourceType: 'dashboard',  Resource: [`collection/${COLLECTION_NAME}`] },
        ],
        AllowFromPublic: true,
      }]),
    });

    // Vector collection
    const collection = new opensearchserverless.CfnCollection(this, 'Collection', {
      name: COLLECTION_NAME,
      type: 'VECTORSEARCH',
      description: 'Vector collection for Intelli-Doc-Engine — indexes: vector, text, metadata',
    });

    // Data access policy — grants both roles access to all three indexes
    new opensearchserverless.CfnAccessPolicy(this, 'DataAccessPolicy', {
      name: `${COLLECTION_NAME}-access`,
      type: 'data',
      policy: JSON.stringify([{
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${COLLECTION_NAME}`],
            Permission: [
              'aoss:CreateCollectionItems',
              'aoss:UpdateCollectionItems',
              'aoss:DescribeCollectionItems',
            ],
          },
          {
            ResourceType: 'index',
            Resource: [
              `index/${COLLECTION_NAME}/${INDEX.VECTOR}`,
              `index/${COLLECTION_NAME}/${INDEX.TEXT}`,
              `index/${COLLECTION_NAME}/${INDEX.METADATA}`,
            ],
            Permission: [
              'aoss:CreateIndex',
              'aoss:UpdateIndex',
              'aoss:DescribeIndex',
              'aoss:ReadDocument',
              'aoss:WriteDocument',
            ],
          },
        ],
        Principal: [
          ingestionRole.roleArn,
          queryRole.roleArn,
          `arn:aws:iam::${accountId}:root`,
        ],
      }]),
    });

    // Allow both roles to call AOSS APIs
    const aossPolicy = new iam.PolicyStatement({
      actions: ['aoss:APIAccessAll'],
      resources: [collection.attrArn],
    });
    ingestionRole.addToPolicy(aossPolicy);
    queryRole.addToPolicy(aossPolicy);

    this.collectionEndpoint = collection.attrCollectionEndpoint;
    this.collectionArn      = collection.attrArn;
  }
}
