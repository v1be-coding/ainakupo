# AInakupo

Records how the series' live apps use AI models: one record per model call, with tokens, latency, cost and eval scores, so each episode can see what its AI features cost and how well they answer.

## Traces

**Sending episode**:
A series episode whose live app reports its model calls to AInakupo.
_Avoid_: Client, tenant, project, source

**Trace**:
The record of one model call made by a sending episode's live app: its model, tokens, latency and cost, and optionally its prompt and response text.
_Avoid_: Span, generation, call, event, log

**Feature**:
A named AI capability within a sending episode's app, such as its chat, that a trace says it came from.
_Avoid_: Endpoint, route, use case

**Run**:
The group of traces a sending episode marks as serving one user request, such as the calls of one agent loop.
_Avoid_: Trace (for the group), session, conversation

**Ingest key**:
The secret a sending episode presents to have its traces accepted; each sending episode has its own.
_Avoid_: API key, token, public key, secret key

**Production key**:
A sending episode's ingest key for its live app; it never allows trace text.
_Avoid_: Live key, prod token

**Preview key**:
A sending episode's ingest key for its branch environments and CI; it allows trace text.
_Avoid_: Test key, staging key, dev key

**Trace text**:
The prompt and response text of a trace, kept only when the sending episode sent it under a key that allows it, and only for a limited time.
_Avoid_: Content, payload, I/O, transcript

## Evals

**Evaluation**:
One score a judge gave a trace against one criterion, with its explanation.
_Avoid_: Eval result, grade, rating, feedback

**Criterion**:
The named quality, with its description, that a sending episode asks the judge to score a trace on.
_Avoid_: Metric, rubric item, dimension

**Judge**:
The Claude model that reads a trace's text and gives an evaluation.
_Avoid_: Grader, evaluator, LLM-as-judge
