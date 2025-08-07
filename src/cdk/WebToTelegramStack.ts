import { Construct } from "constructs";
import { Code, Function, Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import {
  Aws,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cr from "aws-cdk-lib/custom-resources";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch_actions from "aws-cdk-lib/aws-cloudwatch-actions";

// Alpha modules for HTTP API with Lambda integrations/authorizers
import {
  HttpApi,
  CorsHttpMethod,
  HttpMethod,
} from "@aws-cdk/aws-apigatewayv2-alpha";
import { HttpLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";

import {
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
} from "@aws-cdk/aws-apigatewayv2-authorizers-alpha";

interface WebToTelegramStackProps extends StackProps {
  rpcUrl: string;
  dataProviderAddress: string;
  alertBotToken: string;
  alertBotChatId: string;
  noAlertBotToken: string;
  noAlertBotChatId: string;
  watchList: string; // JSON string (seed)
  alertThresholdTokens: string;
  watchlistApiKey: string; // for authorizer and UI
  alarmEmail: string; // SNS subscription for PUT errors
}

export class WebToTelegramStack extends Stack {
  constructor(scope: Construct, id: string, props: WebToTelegramStackProps) {
    super(scope, id, props);

    // DynamoDB watch list
    const watchListTable = new dynamodb.Table(this, "WatchListTable", {
      tableName: "WatchListTable",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Seed table once (if empty) from initial WATCH_LIST
    const seed = new cr.AwsCustomResource(this, "SeedWatchList", {
      onCreate: {
        service: "DynamoDB",
        action: "putItem",
        parameters: {
          TableName: watchListTable.tableName,
          Item: {
            pk: { S: "watchlist" },
            items: {
              L: (
                JSON.parse(props.watchList) as Array<{
                  address: string;
                  name: string;
                }>
              ).map((x) => ({ S: `${x.name}:${x.address}` })),
            },
          },
          ConditionExpression: "attribute_not_exists(pk)",
        },
        physicalResourceId: cr.PhysicalResourceId.of(
          `SeedWatchList-${Aws.ACCOUNT_ID}-${Aws.REGION}`
        ),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [watchListTable.tableArn],
      }),
    });
    seed.node.addDependency(watchListTable);

    // Checker Lambda (ARM, minimal env)
    const webToTelegramLambda = new Function(this, "WebToTelegramLambda", {
      functionName: "WebToTelegramLambda",
      handler: "index.handler",
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
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
              // ethers and axios only
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
        ALERT_THRESHOLD_TOKENS: props.alertThresholdTokens,
        WATCHLIST_TABLE_NAME: watchListTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Least-privilege GetItem only
    webToTelegramLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem"],
        resources: [watchListTable.tableArn],
      })
    );

    // EventBridge rule to trigger Lambda every minute
    const scheduleRule = new Rule(this, "WebToTelegramScheduleRule", {
      ruleName: "WebToTelegramEveryMinute",
      description: "Triggers Web3 to Telegram monitoring every minute",
      schedule: Schedule.rate(Duration.minutes(1)),
    });
    scheduleRule.addTarget(new LambdaFunction(webToTelegramLambda));

    const getWatchListFn = new Function(this, "GetWatchListFn", {
      functionName: "GetWatchListFn",
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: "api/getWatchList.handler",
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
              "npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb --omit=dev --no-audit --no-fund",
            ].join(" && "),
          ],
        },
      }),
      memorySize: 128,
      timeout: Duration.seconds(10),
      environment: {
        WATCHLIST_TABLE_NAME: watchListTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    const putWatchListFn = new Function(this, "PutWatchListFn", {
      functionName: "PutWatchListFn",
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: "api/putWatchList.handler",
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
              "npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb --omit=dev --no-audit --no-fund",
            ].join(" && "),
          ],
        },
      }),
      memorySize: 128,
      timeout: Duration.seconds(10),
      environment: {
        WATCHLIST_TABLE_NAME: watchListTable.tableName,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Lambda authorizer for x-api-key
    const authorizerFn = new Function(this, "ApiKeyAuthorizerFn", {
      functionName: "ApiKeyAuthorizerFn",
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: "api/authorizer.handler",
      code: Code.fromAsset("build/lambdas"),
      memorySize: 128,
      timeout: Duration.seconds(5),
      environment: {
        WATCHLIST_API_KEY: props.watchlistApiKey,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // HTTP API with CORS (allow UI; if unknown at synth time, use wildcard)
    const httpApi = new HttpApi(this, "WatchListHttpApi", {
      corsPreflight: {
        allowHeaders: ["content-type", "x-api-key"],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.PUT,
          CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ["*"],
        maxAge: Duration.days(10),
      },
    });

    const getIntegration = new HttpLambdaIntegration(
      "GetWatchListIntegration",
      getWatchListFn
    );
    const putIntegration = new HttpLambdaIntegration(
      "PutWatchListIntegration",
      putWatchListFn
    );

    const apiKeyAuthorizer = new HttpLambdaAuthorizer(
      "ApiKeyAuthorizer",
      authorizerFn,
      {
        responseTypes: [HttpLambdaResponseType.SIMPLE],
        resultsCacheTtl: Duration.seconds(0),
      }
    );

    httpApi.addRoutes({
      path: "/watchlist",
      methods: [HttpMethod.GET],
      integration: getIntegration,
    });

    httpApi.addRoutes({
      path: "/watchlist",
      methods: [HttpMethod.PUT],
      integration: putIntegration,
      authorizer: apiKeyAuthorizer,
    });

    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });

    // Frontend hosting: S3 + CloudFront + deployment
    const siteBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      enforceSSL: true,
      cors: [{ allowedMethods: [s3.HttpMethods.GET], allowedOrigins: ["*"] }],
    });

    const oai = new cloudfront.OriginAccessIdentity(this, "FrontendOAI");
    siteBucket.grantRead(oai);

    const distribution = new cloudfront.Distribution(
      this,
      "FrontendDistribution",
      {
        defaultBehavior: {
          origin: new origins.S3Origin(siteBucket, {
            originAccessIdentity: oai,
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        defaultRootObject: "index.html",
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.minutes(1),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.minutes(1),
          },
        ],
      }
    );

    new CfnOutput(this, "FrontendUrl", {
      value: `https://${distribution.domainName}`,
    });

    // Add outputs for CI
    new CfnOutput(this, "FrontendBucketName", {
      value: siteBucket.bucketName,
    });
    new CfnOutput(this, "FrontendDistributionId", {
      value: distribution.distributionId,
    });

    // Monitoring: Metric Filter + Alarm for PUT errors
    const metricFilter = new logs.MetricFilter(this, "PutFnErrorMetricFilter", {
      logGroup: putWatchListFn.logGroup,
      metricNamespace: "WatchListApi",
      metricName: "PutErrors",
      filterPattern: logs.FilterPattern.literal("PutWatchListError"),
      metricValue: "1",
    });

    const topic = new sns.Topic(this, "PutErrorsTopic", {
      displayName: "WatchList PUT Errors",
    });
    topic.addSubscription(new subs.EmailSubscription(props.alarmEmail));

    const alarm = metricFilter
      .metric({ period: Duration.minutes(5) })
      .createAlarm(this, "PutErrorsAlarm", {
        threshold: 3,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        alarmDescription: "More than 3 PUT errors in 5 minutes",
      });
    alarm.addAlarmAction(new cloudwatch_actions.SnsAction(topic));

    new CfnOutput(this, "WatchListTableName", {
      value: watchListTable.tableName,
    });
  }
}
