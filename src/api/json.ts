import type { APIGatewayProxyResultV2 } from "aws-lambda";

export type ApiResult = Exclude<APIGatewayProxyResultV2, string>;

// The only way the API answers, so every answer carries the JSON content type.
export function json(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): ApiResult {
  return {
    statusCode,
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
