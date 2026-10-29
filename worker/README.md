# PMF Evaluator Worker

Standalone Cloudflare Worker that serves the evaluator API (`POST /`) so the
tool does not depend on the Lovable-hosted app. It is a dependency-free port of
the app's `src/lib/pmf/*` server modules: validation, CORS allowlist, per-IP
rate limit, Google Form lead capture (before generation), Gemini generation
with structured output, and the deterministic fallback map. Optionally it also
saves every generated map (and the answers behind it) to a second Google Form so
you can review outputs without re-running the model.

## One-time setup

1. Install wrangler: `npm install -g wrangler` and log in: `wrangler login`
2. From this directory, set the secrets (same values as in Lovable → Project Settings → Secrets):

   ```sh
   wrangler secret put GEMINI_API_KEY
   wrangler secret put PMF_LEAD_FORM_URL
   wrangler secret put PMF_LEAD_FORM_ENTRY_EMAIL
   wrangler secret put PMF_LEAD_FORM_ENTRY_STAGE
   wrangler secret put PMF_LEAD_FORM_ENTRY_EVIDENCE
   wrangler secret put PMF_LEAD_FORM_ENTRY_PRODUCT
   wrangler secret put PMF_LEAD_FORM_ENTRY_AUDIENCE
   wrangler secret put PMF_LEAD_FORM_ENTRY_EXPERTISE
   wrangler secret put PMF_LEAD_FORM_ENTRY_UNCERTAINTY
   wrangler secret put PMF_LEAD_FORM_ENTRY_CONSENT
   wrangler secret put PMF_LEAD_FORM_ENTRY_TIMESTAMP
   wrangler secret put PMF_LEAD_FORM_ENTRY_SOURCE
   ```

3. Deploy: `wrangler deploy`
4. Note the worker URL (`https://pmf-evaluator.<your-subdomain>.workers.dev`)
   and set it as `evaluator.api_base` in `content/pmf-evaluator.md`.

## Optional: save every generated map to a second Google Form

Create a second Google Form with exactly four questions (all **optional**,
"Collect email addresses" off, "Restrict to users in your organisation" off),
then set `PMF_MAP_FORM_URL` to its `/formResponse` address plus the four entry
ids. Email, by, at and json are the only columns — everything else travels
inside the json column as one JSON document.

```sh
wrangler secret put PMF_MAP_FORM_URL
wrangler secret put PMF_MAP_ENTRY_EMAIL        # required for logging to happen
wrangler secret put PMF_MAP_ENTRY_GENERATED_BY
wrangler secret put PMF_MAP_ENTRY_TIMESTAMP
wrangler secret put PMF_MAP_ENTRY_RAW
```

| Entry id env var | Column | Contents | Question type |
| --- | --- | --- | --- |
| `PMF_MAP_ENTRY_EMAIL` | email | Visitor email (must exist, or nothing is logged) | Short answer |
| `PMF_MAP_ENTRY_GENERATED_BY` | by | `gemini` or `fallback` | Short answer |
| `PMF_MAP_ENTRY_TIMESTAMP` | at | ISO generation time | Short answer |
| `PMF_MAP_ENTRY_RAW` | json | The full record as JSON (below) | Paragraph |

The `json` column holds one object with everything behind the row:

```json
{
  "email": "founder@example.com",
  "generated_by": "gemini",
  "prompt_version": "v2-context-reasoning",
  "model": "gemini-3.5-flash",
  "latency_ms": 4213,
  "generated_at": "2026-10-29T04:45:12.345Z",
  "source": "amitsharma.tech/pmf-evaluator",
  "consent": "yes",
  "answers": {
    "stage": "Building / prototype",
    "evidence": "We have tested the prototype with potential customers.",
    "uncertainty": "Whether customers will pay enough.",
    "product": "…",
    "audience": "…",
    "expertise": "…"
  },
  "map": { "opportunity_summary": "…", "elements": { "…": "…" }, "next_experiment": { "…": "…" } }
}
```

Because the map is stored verbatim, you can review, export or rebuild any output
from the sheet without calling the model again.

### Prompt versions

`prompt_version` in the record identifies which reasoning prompt produced the
map, so new outputs stay comparable with historical traces. `v2-context-reasoning`
(current) instructs the model to interpret the specific opportunity — naming the
unresolved distinction that matters — instead of summarising inputs, and adds
`next_experiment.interpretation` (what different plausible findings would suggest).
Rows logged before the change have no `prompt_version` field and no
`interpretation` in their experiment.


Logging is deliberately **best-effort**: it runs after the response is built and
any failure is written to `wrangler tail` and swallowed, so a misconfigured,
rate-limited or unreachable log form can never stop a visitor from seeing a map
that generated successfully. If `PMF_MAP_FORM_URL` is unset, nothing is logged
and behaviour is unchanged.

## Local testing

```sh
wrangler dev
curl -X POST http://localhost:8787 -H 'Content-Type: application/json' -d '{"email":"t@example.com","consent":false,"answers":{"product":"A test product description.","stage":"idea","audience":"Small business owners.","expertise":"Not sure yet.","evidence":0,"uncertainty":null}}'
```

## Optional: deploy from GitHub Actions

Add `CF_API_TOKEN` (Cloudflare API token with Workers Scripts Edit) and
`CF_ACCOUNT_ID` as GitHub repo secrets, then:

```yaml
# .github/workflows/deploy-worker.yml
name: Deploy PMF evaluator worker
on:
  push:
    paths: [worker/**]
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          workingDirectory: worker
```

Worker secrets still need to be set once via `wrangler secret put` (or the
Cloudflare dashboard) — the Action only deploys code.

## Notes

- Cost: the Workers free tier (100,000 requests/day) covers this comfortably;
  Gemini usage bills to your own Google AI Studio key.
- Rate limiting here is per worker isolate (10 req / 10 min / IP). For stronger
  protection add a rate-limit rule in Cloudflare → Security → WAF.
- Keep `worker/src/index.js` in sync with `src/lib/pmf/*` if the evaluator
  logic changes (the Lovable app remains a working reference implementation).
