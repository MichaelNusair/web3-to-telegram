#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { WebToTelegramStack } from "@cdk/WebToTelegramStack";

const app = new cdk.App();

new WebToTelegramStack(app, {
  stackName: "web3-to-telegram",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
});
