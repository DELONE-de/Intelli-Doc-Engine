import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

interface IngestionLambdaProps {
  docBucket: s3.Bucket;
  ingestionRole: iam.Role;
  extractionQueue: sqs.Queue;
}

export class IngestionLambda extends Construct {
  public readonly fn: lambda.Function;

  constructor(scope: Construct, id: string, props: IngestionLambdaProps) {
    super(scope, id);

    const { docBucket, ingestionRole, extractionQueue } = props;

    // Textract full access
    ingestionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonTextractFullAccess')
    );

    this.fn = new lambda.Function(this, 'IngestionFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('lambda/ingestion'),
      role: ingestionRole,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        BUCKET_NAME:    docBucket.bucketName,
        SQS_QUEUE_URL:  extractionQueue.queueUrl,
      },
    });

    // S3 trigger — fires on all object uploads
    docBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.fn)
    );

    new cdk.CfnOutput(scope, 'IngestionFunctionArn', { value: this.fn.functionArn });
  }
}
