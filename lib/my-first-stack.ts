import * as cdk from 'aws-cdk-lib';
import { BaseInfraStack }   from './stacks/base-infra-stack';
import { IngestionStack }   from './stacks/ingestion-stack';
import { QueryStack }       from './stacks/query-stack';
import { MonitoringStack }  from './stacks/monitoring-stack';

export function wireStacks(app: cdk.App, env: cdk.Environment) {
  const baseInfra = new BaseInfraStack(app, 'BaseInfraStack', { env });

  const ingestion = new IngestionStack(app, 'IngestionStack', { env, baseInfra });
  ingestion.addDependency(baseInfra);

  const query = new QueryStack(app, 'QueryStack', { env, baseInfra });
  query.addDependency(baseInfra);

  const monitoring = new MonitoringStack(app, 'MonitoringStack', {
    env,
    ingestionStack: ingestion,
    queryStack:     query,
    alarmEmail:     process.env.ALARM_EMAIL,
  });
  monitoring.addDependency(ingestion);
  monitoring.addDependency(query);
}
