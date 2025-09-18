import { Construct } from "constructs";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Stack, StackProps } from "aws-cdk-lib";
import { Duration } from "aws-cdk-lib";

interface WebToTelegramStackProps extends StackProps {
  rpcUrl: string;
  dataProviderAddress: string;
  alertBotToken: string;
  alertBotChatId: string;
  noAlertBotToken: string;
  noAlertBotChatId: string;
  watchList: string; // JSON string
  alertThresholdTokens: string;
}

export class WebToTelegramStack extends Stack {
  constructor(scope: Construct, id: string, props: WebToTelegramStackProps) {
    super(scope, id, props);

    const webToTelegramLambda = new Function(this, "WebToTelegramLambda", {
      functionName: "WebToTelegramLambda",
      handler: "index.handler",
      runtime: Runtime.NODEJS_20_X,
      code: Code.fromAsset("build/lambdas", {
        bundling: {
          image: Runtime.NODEJS_20_X.bundlingImage,
          command: [
            "bash",
            "-c",
            [
              "export npm_config_cache=/tmp/.npm",
              "export npm_config_update_notifier=false",
              "cp -r /asset-input/* /asset-output/",
              "cd /asset-output",
              "npm install ethers axios --omit=dev --no-audit --no-fund",
            ].join(" && "),
          ],
        },
      }),
      timeout: Duration.seconds(30),
      memorySize: 128,
      environment: {
        RPC_URL: props.rpcUrl,
        DATA_PROVIDER_ADDRESS: props.dataProviderAddress,
        ALERT_BOT_TOKEN: props.alertBotToken,
        ALERT_BOT_CHAT_ID: props.alertBotChatId,
        NO_ALERT_BOT_TOKEN: props.noAlertBotToken,
        NO_ALERT_BOT_CHAT_ID: props.noAlertBotChatId,
        WATCH_LIST: props.watchList,
        ALERT_THRESHOLD_TOKENS: props.alertThresholdTokens,
      },
    });

    // EventBridge rule to trigger Lambda every minute
    const scheduleRule = new Rule(this, "WebToTelegramScheduleRule", {
      ruleName: "WebToTelegramEveryMinute",
      description: "Triggers Web3 to Telegram monitoring every minute",
      schedule: Schedule.rate(Duration.days(Number.MAX_SAFE_INTEGER)),
    });

    // Add Lambda as target for the EventBridge rule
    scheduleRule.addTarget(new LambdaFunction(webToTelegramLambda));
  }
}
