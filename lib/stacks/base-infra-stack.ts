import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { OpenSearchVector } from '../constructs/opensearch-vector';

export class BaseInfraStack extends cdk.Stack {
  public readonly docBucket: s3.Bucket;
  public readonly ingestionRole: iam.Role;
  public readonly queryRole: iam.Role;
  public readonly collectionEndpoint: string;
  public readonly extractionQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── S3 Document Bucket ──────────────────────────────────────────────────
    this.docBucket = new s3.Bucket(this, 'DocBucket', {
      bucketName: `intelli-doc-uploads-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    // ── IAM Roles ───────────────────────────────────────────────────────────

    // Role for ingestion Lambda (reads S3, writes to OpenSearch)
    this.ingestionRole = new iam.Role(this, 'IngestionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Role for query Lambda (reads from OpenSearch)
    this.queryRole = new iam.Role(this, 'QueryRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant ingestion role read access to S3 bucket
    this.docBucket.grantRead(this.ingestionRole);

    // ── SQS Extraction Queue ─────────────────────────────────────────────────
    const dlq = new sqs.Queue(this, 'ExtractionDLQ', {
      queueName: 'intelli-doc-extraction-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    this.extractionQueue = new sqs.Queue(this, 'ExtractionQueue', {
      queueName: 'intelli-doc-extraction',
      visibilityTimeout: cdk.Duration.minutes(6),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    // Grant ingestion role send permissions on the queue
    this.extractionQueue.grantSendMessages(this.ingestionRole);

    // Explicit policy for sqs:GetQueueUrl (not covered by grantSendMessages)
    this.ingestionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sqs:GetQueueUrl', 'sqs:GetQueueAttributes'],
      resources: [this.extractionQueue.queueArn],
    }));

    // ── OpenSearch Serverless ────────────────────────────────────────────────
    const openSearch = new OpenSearchVector(this, 'OpenSearchVector', {
      ingestionRole: this.ingestionRole,
      queryRole: this.queryRole,
    });

    this.collectionEndpoint = openSearch.collectionEndpoint;

    // ── Outputs ─────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DocBucketName',       { value: this.docBucket.bucketName });
    new cdk.CfnOutput(this, 'ExtractionQueueUrl',  { value: this.extractionQueue.queueUrl });
    new cdk.CfnOutput(this, 'ExtractionQueueArn',  { value: this.extractionQueue.queueArn });
    new cdk.CfnOutput(this, 'CollectionEndpoint',  { value: openSearch.collectionEndpoint });
    new cdk.CfnOutput(this, 'CollectionArn',       { value: openSearch.collectionArn });
    new cdk.CfnOutput(this, 'IngestionRoleArn',    { value: this.ingestionRole.roleArn });
    new cdk.CfnOutput(this, 'QueryRoleArn',        { value: this.queryRole.roleArn });
  }
}
