import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardRequest } from "../limits/guard.js";
import { handler } from "./handler.js";
import { postEvaluation } from "./routes/evaluations.js";
import { getRecentTraces } from "./routes/recent.js";
import { getSummary } from "./routes/summary.js";
import { postTrace } from "./routes/traces.js";

vi.mock("../limits/guard.js", () => ({ guardRequest: vi.fn() }));
vi.mock("./routes/traces.js", () => ({ postTrace: vi.fn() }));
vi.mock("./routes/evaluations.js", () => ({ postEvaluation: vi.fn() }));
vi.mock("./routes/summary.js", () => ({ getSummary: vi.fn() }));
vi.mock("./routes/recent.js", () => ({ getRecentTraces: vi.fn() }));

const id = "6f1c2f6e-3f0a-4a53-9d7e-0a4f9c1b2d3e";
const routeAnswer = {
  statusCode: 299,
  headers: { "content-type": "application/json" },
  body: "{}",
};

const request = (method: string, rawPath: string, body?: string) =>
  ({ rawPath, body, requestContext: { http: { method } } }) as unknown as APIGatewayProxyEventV2;

const bodyOf = (response: unknown) => JSON.parse((response as { body: string }).body) as unknown;

describe("handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(postTrace).mockResolvedValue(routeAnswer);
    vi.mocked(postEvaluation).mockResolvedValue(routeAnswer);
    vi.mocked(getSummary).mockResolvedValue(routeAnswer);
    vi.mocked(getRecentTraces).mockResolvedValue(routeAnswer);
  });

  it("reports healthy on /api/health", async () => {
    const response = await handler(request("GET", "/api/health"));

    expect(response).toMatchObject({
      statusCode: 200,
      headers: { "content-type": "application/json" },
    });
    expect(bodyOf(response)).toEqual({ status: "ok" });
  });

  it("sends the guard's response instead of running a route", async () => {
    vi.mocked(guardRequest).mockResolvedValue({ statusCode: 429, body: "{}" });

    const response = await handler(request("POST", "/api/traces", "{}"));

    expect(response).toMatchObject({ statusCode: 429 });
    expect(postTrace).not.toHaveBeenCalled();
  });

  it("sends the guard's response before the method check", async () => {
    vi.mocked(guardRequest).mockResolvedValue({ statusCode: 429, body: "{}" });

    const response = await handler(request("DELETE", "/api/summary"));

    expect(response).toMatchObject({ statusCode: 429 });
  });

  it.each([
    ["/nope"],
    ["/api/notes/count"],
    [`/api/notes/${id}`],
    [`/api/traces/${id}`],
    [`/api/traces/${id}/evaluations/extra`],
    ["/api/traces//evaluations"],
  ])("returns the template's 404 for %s", async (path) => {
    for (const method of ["GET", "PUT"]) {
      const response = await handler(request(method, path, '{"text":"hi"}'));

      expect(response).toMatchObject({
        statusCode: 404,
        headers: { "content-type": "application/json" },
      });
      expect(bodyOf(response)).toEqual({ error: "Not found" });
    }
  });

  it("sends POST /api/traces to the traces route", async () => {
    const event = request("POST", "/api/traces", "{}");

    const response = await handler(event);

    expect(postTrace).toHaveBeenCalledWith(event);
    expect(response).toBe(routeAnswer);
  });

  it.each([id, "not-a-uuid"])(
    "sends POST evaluations for trace %s to its route",
    async (traceId) => {
      const event = request("POST", `/api/traces/${traceId}/evaluations`, "{}");

      const response = await handler(event);

      expect(postEvaluation).toHaveBeenCalledWith(event, traceId);
      expect(response).toBe(routeAnswer);
    },
  );

  it("sends GET /api/summary to the summary route", async () => {
    const event = request("GET", "/api/summary");

    const response = await handler(event);

    expect(getSummary).toHaveBeenCalledWith(event);
    expect(response).toBe(routeAnswer);
  });

  it("sends GET /api/traces/recent to the recent route", async () => {
    const event = request("GET", "/api/traces/recent");

    const response = await handler(event);

    expect(getRecentTraces).toHaveBeenCalledWith(event);
    expect(response).toBe(routeAnswer);
  });

  it.each([
    ["POST", "/api/traces", postTrace],
    ["GET", "/api/traces/recent", getRecentTraces],
    ["POST", `/api/traces/${id}/evaluations`, postEvaluation],
    ["GET", "/api/summary", getSummary],
  ] as const)(
    "answers a JSON 500 when %s %s throws, logging only the error's name",
    async (method, path, route) => {
      const secret = "aik_prev_secret-key-and-trace-text";
      const error = new Error(`query failed: params ${secret}`);
      error.name = "DatabaseError";
      vi.mocked(route).mockRejectedValue(error);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await handler(request(method, path, "{}"));

      expect(response).toMatchObject({
        statusCode: 500,
        headers: { "content-type": "application/json" },
      });
      expect(bodyOf(response)).toEqual({ error: "internal", message: "Internal error" });
      expect(log).toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).toContain("DatabaseError");
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
      log.mockRestore();
    },
  );

  it.each([
    ["GET", "/api/traces"],
    ["PUT", "/api/traces"],
    ["PATCH", "/api/traces"],
    ["DELETE", "/api/traces"],
    ["GET", `/api/traces/${id}/evaluations`],
    ["PUT", `/api/traces/${id}/evaluations`],
    ["DELETE", "/api/traces/not-a-uuid/evaluations"],
    ["POST", "/api/summary"],
    ["PUT", "/api/summary"],
    ["DELETE", "/api/summary"],
    ["POST", "/api/traces/recent"],
    ["PUT", "/api/traces/recent"],
    ["DELETE", "/api/traces/recent"],
  ])("returns 405 for %s %s without running the route", async (method, path) => {
    const response = await handler(request(method, path, "not json"));

    expect(response).toMatchObject({
      statusCode: 405,
      headers: { "content-type": "application/json" },
    });
    expect(bodyOf(response)).toEqual({
      error: "method_not_allowed",
      message: "Method not allowed",
    });
    expect(postTrace).not.toHaveBeenCalled();
    expect(postEvaluation).not.toHaveBeenCalled();
    expect(getSummary).not.toHaveBeenCalled();
    expect(getRecentTraces).not.toHaveBeenCalled();
  });
});
