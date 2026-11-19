import type { APIGatewayProxyEventV2 } from "aws-lambda";

// 8-4-4-4-12 hex digits, any case, any version.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The body's raw bytes, so a size limit counts what the sender sent, not the decoded string.
export function bodyBytes(event: APIGatewayProxyEventV2): Buffer {
  const raw = event.body ?? "";
  return event.isBase64Encoded ? Buffer.from(raw, "base64") : Buffer.from(raw, "utf8");
}

export function bodyText(event: APIGatewayProxyEventV2): string {
  const raw = event.body ?? "";
  return event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;
}
