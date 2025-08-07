#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { WebToTelegramStack } from "@cdk/WebToTelegramStack";

const app = new cdk.App();

const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
};

new WebToTelegramStack(app, "web3-to-telegram", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  rpcUrl: getRequiredEnv("RPC_URL"),
  dataProviderAddress: getRequiredEnv("DATA_PROVIDER_ADDRESS"),
  alertBotToken: getRequiredEnv("ALERT_BOT_TOKEN"),
  alertBotChatId: getRequiredEnv("ALERT_BOT_CHAT_ID"),
  noAlertBotToken: getRequiredEnv("NO_ALERT_BOT_TOKEN"),
  noAlertBotChatId: getRequiredEnv("NO_ALERT_BOT_CHAT_ID"),
  watchList: getRequiredEnv("WATCH_LIST"),
  alertThresholdTokens: getRequiredEnv("ALERT_THRESHOLD_TOKENS"),
});
