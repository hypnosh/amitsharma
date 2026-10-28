# PMF Evaluator Worker

Standalone Cloudflare Worker that serves the evaluator API (`POST /`) so the
tool does not depend on the Lovable-hosted app. It is a dependency-free port of
the app's `src/lib/pmf/*` server modules: validation, CORS allowlist, per-IP
rate limit, Google Form lead capture (before generation), Gemini generation
with structured output, and the deterministic fallback map.

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
