import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.WATCHLIST_TABLE_NAME!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-api-key",
  "access-control-allow-methods": "GET,PUT,OPTIONS",
  "content-type": "application/json",
};

type Item = { name: string; address: string };

export const handler = async (event: any) => {
  if (event?.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  try {
    const body =
      typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    const items: Item[] = Array.isArray(body?.items) ? body.items : [];

    // Basic validation
    for (const it of items) {
      if (
        !it ||
        typeof it.name !== "string" ||
        typeof it.address !== "string" ||
        !/^0x[a-fA-F0-9]{40}$/.test(it.address)
      ) {
        return {
          statusCode: 400,
          headers: cors,
          body: JSON.stringify({ error: "Invalid items" }),
        };
      }
    }

    const stored = items.map((x) => `${x.name}:${x.address}`);

    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: { pk: "watchlist", items: stored },
      })
    );

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true }),
    };
  } catch (e) {
    console.error("PutWatchListError", e);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: "Internal error" }),
    };
  }
};
