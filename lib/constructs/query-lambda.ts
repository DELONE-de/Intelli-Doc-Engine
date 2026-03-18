import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface QueryLambdaProps {
  queryRole: iam.Role;
  collectionEndpoint: string;
}

export class QueryLambda extends Construct {
  public readonly fn: lambda.Function;

  constructor(scope: Construct, id: string, props: QueryLambdaProps) {
    super(scope, id);

    const { queryRole, collectionEndpoint } = props;

    // Bedrock access for LLM inference
    queryRole.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
    }));

    this.fn = new lambda.Function(this, 'QueryFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('lambda/query'),
      role: queryRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        COLLECTION_ENDPOINT: collectionEndpoint,
      },
    });
  }
}
