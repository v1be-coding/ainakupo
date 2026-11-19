# Ingest is our own JSON API, with OpenTelemetry GenAI field names

Senders POST one flat JSON trace per model call to `/api/traces`, rather than sending OTLP. OTLP is a large, nested, partly binary format, the OpenTelemetry GenAI conventions are still in Development status and define no cost field, and a flat JSON body is what a one-run build and its frozen tests can pin down exactly. Field names and meanings follow the GenAI conventions (`provider`, `model`, `inputTokens` including cached tokens, `outputTokens`), so accepting OTLP later is a mapping, not a remodel.
