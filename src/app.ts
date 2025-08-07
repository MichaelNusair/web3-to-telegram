import { App } from "aws-cdk-lib";
import { WebToTelegramStack } from "./cdk/WebToTelegramStack";

const app = new App();

const required = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

new WebToTelegramStack(app, "web3-to-telegram", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  rpcUrl: required("RPC_URL"),
  dataProviderAddress: required("DATA_PROVIDER_ADDRESS"),
  alertBotToken: required("ALERT_BOT_TOKEN"),
  alertBotChatId: required("ALERT_BOT_CHAT_ID"),
  noAlertBotToken: required("NO_ALERT_BOT_TOKEN"),
  noAlertBotChatId: required("NO_ALERT_BOT_CHAT_ID"),
  watchList: required("WATCH_LIST"),
  alertThresholdTokens: required("ALERT_THRESHOLD_TOKENS"),
  watchlistApiKey: required("WATCHLIST_API_KEY"),
  alarmEmail: required("ALARM_EMAIL"),
});
