import { Construct } from "constructs";
import { Code, Function, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Stack, StackProps } from "aws-cdk-lib";
import { Duration } from "aws-cdk-lib";

export class WebToTelegramStack extends Stack {
  constructor(scope: Construct, props: StackProps) {
    super(scope, "WebToTelegramStack", props);

    const commonLayer = this.createCommonLambdaLayer();

    const webToTelegramLambda = new Function(this, "WebToTelegramLambda", {
      functionName: "WebToTelegramLambda",
      handler: "index.handler",
      runtime: Runtime.NODEJS_20_X,
      code: Code.fromAsset("build/lambdas"),
      layers: [commonLayer],
      timeout: Duration.seconds(30),
      memorySize: 128,
    });

    // EventBridge rule to trigger Lambda every minute
    const scheduleRule = new Rule(this, "WebToTelegramScheduleRule", {
      ruleName: "WebToTelegramEveryMinute",
      description: "Triggers Web3 to Telegram monitoring every minute",
      schedule: Schedule.rate(Duration.minutes(1)),
    });

    // Add Lambda as target for the EventBridge rule
    scheduleRule.addTarget(new LambdaFunction(webToTelegramLambda));
  }

  createCommonLambdaLayer = () => {
    const name = `CommonLambdaLayer`;
    return new LayerVersion(this, name, {
      description: "Common Lambda layer",
      layerVersionName: name,
      code: Code.fromAsset("build/layers/common-layer/layer.zip"),
    });
  };
}
