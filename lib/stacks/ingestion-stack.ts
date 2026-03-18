import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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

    const { fn } = new IngestionLambda(this, 'IngestionLambda', {
      docBucket:       props.baseInfra.docBucket,
      ingestionRole:   props.baseInfra.ingestionRole,
      extractionQueue: props.baseInfra.extractionQueue,
    });

    this.ingestionFn = fn;
  }
}
