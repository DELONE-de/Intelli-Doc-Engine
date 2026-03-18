import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseInfraStack } from './base-infra-stack';
import { QueryLambda } from '../constructs/query-lambda';
import { ApiGateway } from '../constructs/api-gateway';

interface QueryStackProps extends cdk.StackProps {
  baseInfra: BaseInfraStack;
}

export class QueryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: QueryStackProps) {
    super(scope, id, props);

    const { queryRole, collectionEndpoint } = props.baseInfra;

    const { fn } = new QueryLambda(this, 'QueryLambda', {
      queryRole,
      collectionEndpoint,
    });

    new ApiGateway(this, 'ApiGateway', { queryFn: fn });
  }
}
