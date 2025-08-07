import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.WATCHLIST_TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-api-key",
  "access-control-allow-methods": "GET,PUT,OPTIONS",
  "content-type": "application/json",
};

export const handler = async () => {
  try {
    const res = await ddb.send(
      new GetCommand({ TableName: TABLE, Key: { pk: "watchlist" } })
    );
    const items = (res.Item?.items as string[] | undefined) ?? [];
    return { statusCode: 200, headers: cors, body: JSON.stringify({ items }) };
  } catch (e) {
    console.error("GetWatchListError", e);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: "Internal error" }),
    };
  }
};
