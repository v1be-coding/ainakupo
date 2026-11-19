// Keyed requests to AInakupo go through Node's fetch, never Playwright's
// `request` or the browser, because branch runs upload Playwright traces and
// those record request headers (spec #4, How the frozen tests must send keyed
// requests). This reference is taken when the helpers load, before the SDK is
// imported, so nothing the SDK does to `fetch` reaches these requests.
export const nodeFetch: typeof fetch = globalThis.fetch.bind(globalThis);

// What a test may look at. Never the request's headers.
export type KeyedResponse = {
  status: number;
  contentType: string | null;
  retryAfter: string | null;
  body: unknown;
};

export type KeyedRequest = {
  // The whole `authorization` header, or undefined to send none.
  authorization?: string;
  // Sent as JSON, unless `raw` is given.
  json?: unknown;
  // Sent as is, for bodies that aren't valid JSON.
  raw?: string;
};

// A body that isn't JSON comes back as this, so a test's toEqual shows it.
export type NotJson = { notJson: string };

export function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { notJson: text.slice(0, 300) } satisfies NotJson;
  }
}

export async function sendKeyed(url: string, request: KeyedRequest): Promise<KeyedResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (request.authorization !== undefined) headers.authorization = request.authorization;
  const response = await nodeFetch(url, {
    method: "POST",
    headers,
    body: request.raw ?? JSON.stringify(request.json),
    redirect: "manual",
  });
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    retryAfter: response.headers.get("retry-after"),
    body: parseBody(await response.text()),
  };
}

// A JSON object padded with spaces before its closing brace to exactly `bytes`
// bytes of UTF-8, for the body size limit.
export function jsonOfBytes(value: Record<string, unknown>, bytes: number): string {
  const text = JSON.stringify(value);
  const size = Buffer.byteLength(text, "utf8");
  if (size > bytes) throw new Error(`The object is already ${size} bytes, over ${bytes}.`);
  return `${text.slice(0, -1)}${" ".repeat(bytes - size)}}`;
}
