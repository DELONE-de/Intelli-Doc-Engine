#!/usr/bin/env node
import 'source-map-support/register';
import * as dotenv from 'dotenv';
dotenv.config();
import * as cdk from 'aws-cdk-lib';
import { wireStacks } from '../lib/my-first-stack';

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

wireStacks(app, env);