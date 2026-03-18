import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { BaseInfraStack } from './base-infra-stack';
import { IngestionLambda } from '../constructs/ingestion-lambda';

interface IngestionStackProps extends cdk.StackProps {
  baseInfra: BaseInfraStack;
}

export class IngestionStack extends cdk.Stack {
  public readonly ingestionFn: lambda.Function;

  constructor(scope: Construct, id: string, props: IngestionStackProps) {
    super(scope, id, props);

    const { docBucket, ingestionRole, extractionQueue } = props.baseInfra;

    const { fn } = new IngestionLambda(this, 'IngestionLambda', {
      docBucket,
      ingestionRole,
      extractionQueue,
    });

    this.ingestionFn = fn;

    // Use EventBridge rule instead of addEventNotification to avoid cross-stack cyclic dependency
    new events.Rule(this, 'S3UploadRule', {
      eventPattern: {
        source:     ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [docBucket.bucketName] },
        },
      },
      targets: [new targets.LambdaFunction(fn)],
    });
  }
}
