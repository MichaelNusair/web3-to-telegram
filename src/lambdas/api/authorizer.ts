const API_KEY = process.env.WATCHLIST_API_KEY!;

/**
 * Simple HTTP API Lambda Authorizer (response type: SIMPLE)
 * Event shape: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html
 */
export const handler = async (event: any) => {
  const headerKey =
    event?.headers?.["x-api-key"] ?? event?.headers?.["X-Api-Key"];
  const isAuthorized = typeof headerKey === "string" && headerKey === API_KEY;
  return {
    isAuthorized,
    context: { reason: isAuthorized ? "ok" : "invalid" },
  };
};
