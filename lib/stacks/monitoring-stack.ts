import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { IngestionStack } from './ingestion-stack';
import { QueryStack } from './query-stack';

interface MonitoringStackProps extends cdk.StackProps {
  ingestionStack: IngestionStack;
  queryStack:     QueryStack;
  alarmEmail?:    string;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { ingestionFn } = props.ingestionStack;
    const { queryFn }     = props.queryStack;

    // ── SNS Topic for alarm notifications ───────────────────────────────────
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'intelli-doc-alarms',
    });

    if (props.alarmEmail) {
      alarmTopic.addSubscription(new subscriptions.EmailSubscription(props.alarmEmail));
    }

    // ── Lambda Alarms ────────────────────────────────────────────────────────
    this.createLambdaAlarms(ingestionFn, 'Ingestion', alarmTopic);
    this.createLambdaAlarms(queryFn,     'Query',     alarmTopic);

    // ── Bedrock Model Alarms ─────────────────────────────────────────────────
    this.createBedrockAlarms(alarmTopic);

    // ── CloudWatch Dashboard ─────────────────────────────────────────────────
    this.createDashboard(ingestionFn, queryFn);
  }

  private createLambdaAlarms(fn: lambda.Function, label: string, topic: sns.Topic): void {
    // Errors alarm
    const errorsAlarm = new cloudwatch.Alarm(this, `${label}ErrorsAlarm`, {
      alarmName:          `intelli-doc-${label.toLowerCase()}-errors`,
      alarmDescription:   `${label} Lambda error rate too high`,
      metric:             fn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold:          5,
      evaluationPeriods:  2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData:   cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    errorsAlarm.addAlarmAction(new actions.SnsAction(topic));

    // Throttles alarm
    const throttlesAlarm = new cloudwatch.Alarm(this, `${label}ThrottlesAlarm`, {
      alarmName:          `intelli-doc-${label.toLowerCase()}-throttles`,
      alarmDescription:   `${label} Lambda is being throttled`,
      metric:             fn.metricThrottles({ period: cdk.Duration.minutes(5) }),
      threshold:          10,
      evaluationPeriods:  1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData:   cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    throttlesAlarm.addAlarmAction(new actions.SnsAction(topic));

    // Duration alarm — alert if p99 duration exceeds 80% of timeout
    const durationAlarm = new cloudwatch.Alarm(this, `${label}DurationAlarm`, {
      alarmName:          `intelli-doc-${label.toLowerCase()}-duration`,
      alarmDescription:   `${label} Lambda p99 duration is too high`,
      metric:             fn.metricDuration({
        period:    cdk.Duration.minutes(5),
        statistic: 'p99',
      }),
      threshold:          fn.timeout?.toMilliseconds() ?? 30000 * 0.8,
      evaluationPeriods:  2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData:   cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    durationAlarm.addAlarmAction(new actions.SnsAction(topic));
  }

  private createBedrockAlarms(topic: sns.Topic): void {
    const bedrockNamespace = 'AWS/Bedrock';

    // Bedrock invocation errors
    const bedrockErrorsAlarm = new cloudwatch.Alarm(this, 'BedrockInvocationErrorsAlarm', {
      alarmName:          'intelli-doc-bedrock-invocation-errors',
      alarmDescription:   'Bedrock model invocation errors too high',
      metric: new cloudwatch.Metric({
        namespace:  bedrockNamespace,
        metricName: 'InvocationClientErrors',
        period:     cdk.Duration.minutes(5),
        statistic:  'Sum',
      }),
      threshold:          5,
      evaluationPeriods:  2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData:   cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    bedrockErrorsAlarm.addAlarmAction(new actions.SnsAction(topic));

    // Bedrock latency alarm
    const bedrockLatencyAlarm = new cloudwatch.Alarm(this, 'BedrockLatencyAlarm', {
      alarmName:          'intelli-doc-bedrock-latency',
      alarmDescription:   'Bedrock model invocation latency too high',
      metric: new cloudwatch.Metric({
        namespace:  bedrockNamespace,
        metricName: 'InvocationLatency',
        period:     cdk.Duration.minutes(5),
        statistic:  'p99',
      }),
      threshold:          10000, // 10 seconds
      evaluationPeriods:  2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData:   cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    bedrockLatencyAlarm.addAlarmAction(new actions.SnsAction(topic));

    // Bedrock throttles alarm
    const bedrockThrottlesAlarm = new cloudwatch.Alarm(this, 'BedrockThrottlesAlarm', {
      alarmName:          'intelli-doc-bedrock-throttles',
      alarmDescription:   'Bedrock model is being throttled',
      metric: new cloudwatch.Metric({
        namespace:  bedrockNamespace,
        metricName: 'InvocationThrottles',
        period:     cdk.Duration.minutes(5),
        statistic:  'Sum',
      }),
      threshold:          3,
      evaluationPeriods:  1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData:   cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    bedrockThrottlesAlarm.addAlarmAction(new actions.SnsAction(topic));
  }

  private createDashboard(ingestionFn: lambda.Function, queryFn: lambda.Function): void {
    const dashboard = new cloudwatch.Dashboard(this, 'IntelliDocDashboard', {
      dashboardName: 'IntelliDoc-Engine',
    });

    // ── Ingestion Lambda widgets ─────────────────────────────────────────────
    dashboard.addWidgets(
      new cloudwatch.TextWidget({ markdown: '## Ingestion Lambda', width: 24, height: 1 }),

      new cloudwatch.GraphWidget({
        title:  'Ingestion — Invocations & Errors',
        width:  12,
        left:   [ingestionFn.metricInvocations({ period: cdk.Duration.minutes(5) })],
        right:  [ingestionFn.metricErrors({ period: cdk.Duration.minutes(5) })],
      }),

      new cloudwatch.GraphWidget({
        title:  'Ingestion — Duration (p50/p99)',
        width:  12,
        left: [
          ingestionFn.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p50', label: 'p50' }),
          ingestionFn.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p99', label: 'p99' }),
        ],
      }),
    );

    // ── Query Lambda widgets ─────────────────────────────────────────────────
    dashboard.addWidgets(
      new cloudwatch.TextWidget({ markdown: '## Query Lambda', width: 24, height: 1 }),

      new cloudwatch.GraphWidget({
        title:  'Query — Invocations & Errors',
        width:  12,
        left:   [queryFn.metricInvocations({ period: cdk.Duration.minutes(5) })],
        right:  [queryFn.metricErrors({ period: cdk.Duration.minutes(5) })],
      }),

      new cloudwatch.GraphWidget({
        title:  'Query — Duration (p50/p99)',
        width:  12,
        left: [
          queryFn.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p50', label: 'p50' }),
          queryFn.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p99', label: 'p99' }),
        ],
      }),
    );

    // ── Bedrock widgets ──────────────────────────────────────────────────────
    dashboard.addWidgets(
      new cloudwatch.TextWidget({ markdown: '## Bedrock Model', width: 24, height: 1 }),

      new cloudwatch.GraphWidget({
        title: 'Bedrock — Invocations & Errors',
        width: 12,
        left: [
          new cloudwatch.Metric({ namespace: 'AWS/Bedrock', metricName: 'Invocations',           period: cdk.Duration.minutes(5), statistic: 'Sum' }),
          new cloudwatch.Metric({ namespace: 'AWS/Bedrock', metricName: 'InvocationClientErrors', period: cdk.Duration.minutes(5), statistic: 'Sum' }),
        ],
      }),

      new cloudwatch.GraphWidget({
        title: 'Bedrock — Latency (p50/p99)',
        width: 12,
        left: [
          new cloudwatch.Metric({ namespace: 'AWS/Bedrock', metricName: 'InvocationLatency', period: cdk.Duration.minutes(5), statistic: 'p50', label: 'p50' }),
          new cloudwatch.Metric({ namespace: 'AWS/Bedrock', metricName: 'InvocationLatency', period: cdk.Duration.minutes(5), statistic: 'p99', label: 'p99' }),
        ],
      }),
    );

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home#dashboards:name=IntelliDoc-Engine`,
    });
  }
}
