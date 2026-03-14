#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MyFirstStack } from '../lib/my-first-stack';

const app = new cdk.App();
new MyFirstStack(app, 'MyFirstStack');