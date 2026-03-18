import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface ApiGatewayProps {
  queryFn: lambda.Function;
}

export class ApiGateway extends Construct {
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    this.api = new apigw.RestApi(this, 'IntelliDocApi', {
      restApiName: 'intelli-doc-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
      },
    });

    const queryIntegration = new apigw.LambdaIntegration(props.queryFn, {
      proxy: false,
      requestTemplates: {
        'application/json': JSON.stringify({
          body: '$util.escapeJavaScript($input.body)',
          queryParams: '$input.params().querystring',
          pathParams: '$input.params().path',
          headers: '$input.params().header',
        }),
      },
      integrationResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
          },
        },
        {
          selectionPattern: '.*error.*',
          statusCode: '500',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': "'*'",
          },
        },
      ],
    });

    this.api.root
      .addResource('query')
      .addMethod('POST', queryIntegration, {
        methodResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
          {
            statusCode: '500',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': true,
            },
          },
        ],
      });

    new cdk.CfnOutput(scope, 'ApiEndpoint', { value: `${this.api.url}query` });
  }
}
