import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { guardRequest } from "../limits/guard.js";
import { json, type ApiResult } from "./json.js";
import { postEvaluation } from "./routes/evaluations.js";
import { getRecentTraces } from "./routes/recent.js";
import { getSummary } from "./routes/summary.js";
import { postTrace } from "./routes/traces.js";

type RouteHandler = (event: APIGatewayProxyEventV2, param: string) => Promise<ApiResult>;

interface Route {
  // A route's single capture group, if any, is passed to its handlers.
  path: RegExp;
  methods: Partial<Record<string, RouteHandler>>;
}

const routes: Route[] = [
  { path: /^\/api\/traces$/, methods: { POST: (event) => postTrace(event) } },
  { path: /^\/api\/traces\/recent$/, methods: { GET: (event) => getRecentTraces(event) } },
  // Any segment reaches the route, so a non-UUID ID gets the route's own answer.
  { path: /^\/api\/traces\/([^/]+)\/evaluations$/, methods: { POST: postEvaluation } },
  { path: /^\/api\/summary$/, methods: { GET: (event) => getSummary(event) } },
];

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const refused = await guardRequest(event);
  if (refused) return refused;

  // The template's health check, kept as it was: any method.
  if (event.rawPath === "/api/health") return json(200, { status: "ok" });

  for (const route of routes) {
    const match = route.path.exec(event.rawPath);
    if (!match) continue;

    const run = route.methods[event.requestContext.http.method];
    // Before any key or body check, so a wrong method always gets the 405.
    if (!run) return json(405, { error: "method_not_allowed", message: "Method not allowed" });
    return run(event, match[1] ?? "");
  }

  return json(404, { error: "Not found" });
}
