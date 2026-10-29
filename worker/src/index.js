/**
 * PMF Evaluator API — standalone Cloudflare Worker.
 *
 * Dependency-free port of the Lovable app's src/lib/pmf/* server modules,
 * so the evaluator does not depend on the Lovable-hosted app.
 *
 * Endpoint: POST /  (also handles OPTIONS preflight)
 *
 * Configuration (wrangler secret put <NAME>, or [vars] for non-secrets):
 *   GEMINI_API_KEY                 (secret) Google AI Studio key
 *   PMF_LEAD_FORM_URL              (secret) Google Form .../formResponse URL
 *   PMF_LEAD_FORM_ENTRY_EMAIL      (secret) entry id — email (required)
 *   PMF_LEAD_FORM_ENTRY_STAGE      (secret) entry id — founder stage
 *   PMF_LEAD_FORM_ENTRY_EVIDENCE   (secret) entry id — evidence answer
 *   PMF_LEAD_FORM_ENTRY_PRODUCT    (secret) entry id — product description
 *   PMF_LEAD_FORM_ENTRY_AUDIENCE   (secret) entry id — audience/problem
 *   PMF_LEAD_FORM_ENTRY_EXPERTISE  (secret) entry id — expertise/advantage
 *   PMF_LEAD_FORM_ENTRY_UNCERTAINTY (secret) entry id — biggest uncertainty
 *   PMF_LEAD_FORM_ENTRY_CONSENT    (secret) entry id — marketing consent
 *   PMF_LEAD_FORM_ENTRY_TIMESTAMP  (secret) entry id — submission timestamp
 *   PMF_LEAD_FORM_ENTRY_SOURCE     (secret) entry id — source marker
 *   PMF_MAP_FORM_URL               (secret, optional) second Google Form that
 *                                  receives the GENERATED MAP. Logging is
 *                                  non-blocking: a failure here never stops a
 *                                  visitor from seeing their map.
 *   PMF_MAP_ENTRY_EMAIL            (secret) entry id — email (required to log)
 *   PMF_MAP_ENTRY_GENERATED_BY     (secret) entry id — "gemini" or "fallback"
 *   PMF_MAP_ENTRY_TIMESTAMP        (secret) entry id — ISO generation time
 *   PMF_MAP_ENTRY_RAW              (secret) entry id — the full record as JSON

 *   PMF_GEMINI_MODEL               (var, optional) default gemini-3.5-flash
 *   PMF_ALLOWED_ORIGINS            (var, optional) extra comma-separated origins
 */

const MAX_BODY_BYTES = 20_000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;
const GEMINI_TIMEOUT_MS = 45_000;
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.5-flash";

/** Per-isolate fixed-window limiter (same caveat as the Lovable version:
 *  add Cloudflare WAF rate-limit rules for cross-isolate protection). */
const hits = new Map();

function rateLimited(key) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX_REQUESTS;
}

// ---------------------------------------------------------------------------
// Canonical choices and labels (mirror of schema.server.ts)
// ---------------------------------------------------------------------------

const PMF_STAGES = ["idea", "building", "launched", "paying"];

const EVIDENCE_OPTIONS = {
  idea: [
    "Not yet. It is currently an idea or belief.",
    "I have seen the problem or heard individual accounts.",
    "I have heard similar accounts from multiple potential customers.",
    "I have observed people taking action to solve it.",
  ],
  building: [
    "Mostly our own assumptions so far.",
    "We have received feedback or expressions of interest.",
    "We have tested the prototype with potential customers.",
    "Some have committed time, data, money or another meaningful resource.",
  ],
  launched: [
    "We do not yet have a clear picture.",
    "We attract interest, but conversion is weak or unclear.",
    "People use the product, but payment or repeat use is uncertain.",
    "We have paying customers, but acquisition or conversion is a challenge.",
  ],
  paying: [
    "We have not established this clearly.",
    "We see usage, but are not sure which customers benefit most.",
    "We see repeat usage, renewal or other signs of ongoing value.",
    "Some customers renew, expand or refer others, and we have evidence of this.",
  ],
};

const UNCERTAINTY_OPTIONS = [
  "Whether the problem is important enough.",
  "Which customers need this most.",
  "Whether our solution addresses the problem.",
  "Whether customers will pay enough.",
  "How to reach and acquire customers.",
  "Whether customers will keep using or paying for it.",
  "Whether we have a meaningful advantage.",
  "I am not sure yet.",
];

const STAGE_LABELS = {
  idea: "Idea / pre-build",
  building: "Building / prototype",
  launched: "Launched / acquiring customers",
  paying: "Paying customers / growth challenges",
};

const PMF_STATUSES = ["Described", "Assumed", "Evidence provided", "Unverified", "Needs exploration"];

function evidenceLabel(answers) {
  return EVIDENCE_OPTIONS[answers.stage][answers.evidence] ?? "";
}

function uncertaintyLabel(answers) {
  if (answers.uncertainty == null) return null;
  return UNCERTAINTY_OPTIONS[answers.uncertainty] ?? null;
}

// ---------------------------------------------------------------------------
// Request validation (hand-rolled mirror of evaluatorRequestSchema)
// ---------------------------------------------------------------------------

function isString(v, min, max) {
  return typeof v === "string" && v.trim().length >= min && v.length <= max;
}

function isInt(v, min, max) {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns { ok: true, input } or { ok: false, fields } */
function validateRequest(raw) {
  const fields = [];
  if (!raw || typeof raw !== "object") return { ok: false, fields: [{ path: "", code: "invalid_type" }] };

  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) fields.push({ path: "email", code: "invalid_string" });
  if (typeof raw.consent !== "boolean") fields.push({ path: "consent", code: "invalid_type" });

  const a = raw.answers ?? {};
  if (!isString(a.product, 10, 2000)) fields.push({ path: "answers.product", code: "invalid_string" });
  if (!PMF_STAGES.includes(a.stage)) fields.push({ path: "answers.stage", code: "invalid_enum" });
  if (!isString(a.audience, 10, 2000)) fields.push({ path: "answers.audience", code: "invalid_string" });
  if (!isString(a.expertise, 3, 2000)) fields.push({ path: "answers.expertise", code: "invalid_string" });
  if (!isInt(a.evidence, 0, 3)) fields.push({ path: "answers.evidence", code: "invalid_number" });
  if (!(a.uncertainty === null || isInt(a.uncertainty, 0, 7)))
    fields.push({ path: "answers.uncertainty", code: "invalid_type" });

  if (fields.length) return { ok: false, fields };
  return {
    ok: true,
    input: {
      email,
      consent: raw.consent,
      answers: {
        product: a.product.trim(),
        stage: a.stage,
        audience: a.audience.trim(),
        expertise: a.expertise.trim(),
        evidence: a.evidence,
        uncertainty: a.uncertainty,
      },
      meta: isString(raw.meta?.source, 0, 120) ? { source: raw.meta.source.trim() } : undefined,
    },
  };
}

/** Structural check mirroring pmfMapSchema. */
function validMap(m) {
  const el = (e) =>
    e &&
    isString(e.summary, 1, 10000) &&
    PMF_STATUSES.includes(e.status) &&
    typeof e.supporting_input === "string" &&
    typeof e.what_remains_unknown === "string";
  return (
    m &&
    isString(m.opportunity_summary, 1, 10000) &&
    m.elements &&
    el(m.elements.technology) &&
    el(m.elements.audience_need) &&
    el(m.elements.willingness_to_pay) &&
    el(m.elements.founder_expertise) &&
    isString(m.interesting_hypothesis, 1, 10000) &&
    isString(m.key_uncertainty, 1, 10000) &&
    m.next_experiment &&
    isString(m.next_experiment.action, 1, 10000) &&
    isString(m.next_experiment.target, 1, 10000) &&
    isString(m.next_experiment.question_or_observation, 1, 10000) &&
    isString(m.next_experiment.meaningful_evidence, 1, 10000) &&
    Array.isArray(m.remaining_unknowns) &&
    m.remaining_unknowns.length >= 1 &&
    m.remaining_unknowns.length <= 6 &&
    m.remaining_unknowns.every((u) => isString(u, 1, 10000)) &&
    isString(m.limitations, 1, 10000)
  );
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function allowedOrigins(env) {
  const configured = (env.PMF_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const defaults = ["https://amitsharma.tech", "https://www.amitsharma.tech"];
  return [...new Set([...defaults, ...configured])];
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") ?? "";
  const allowed = allowedOrigins(env);
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && (allowed.includes(origin) || allowed.includes("*"))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin or server-to-server
  if (origin === new URL(request.url).origin) return true;
  const allowed = allowedOrigins(env);
  return allowed.includes(origin) || allowed.includes("*");
}

function json(body, status, extraHeaders = {}) {
  return Response.json(body, { status, headers: extraHeaders });
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// ---------------------------------------------------------------------------
// Lead persistence (owner's Google Form, server-side POST)
// ---------------------------------------------------------------------------

function entry(env, name) {
  const raw = env[name];
  if (typeof raw !== "string") return undefined;
  // Tolerate values pasted with surrounding quotes or whitespace.
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  return value || undefined;
}

function leadCaptureConfigured(env) {
  return Boolean(entry(env, "PMF_LEAD_FORM_URL") && entry(env, "PMF_LEAD_FORM_ENTRY_EMAIL"));
}

async function persistLead(env, input) {
  const formUrl = entry(env, "PMF_LEAD_FORM_URL");
  const emailEntry = entry(env, "PMF_LEAD_FORM_ENTRY_EMAIL");
  if (!formUrl || !emailEntry) return { ok: false, reason: "lead_capture_not_configured" };

  const params = new URLSearchParams();
  params.set(emailEntry, input.email);
  const optional = [
    ["PMF_LEAD_FORM_ENTRY_STAGE", input.stage],
    ["PMF_LEAD_FORM_ENTRY_EVIDENCE", input.evidence],
    ["PMF_LEAD_FORM_ENTRY_PRODUCT", input.product],
    ["PMF_LEAD_FORM_ENTRY_AUDIENCE", input.audience],
    ["PMF_LEAD_FORM_ENTRY_EXPERTISE", input.expertise],
    ["PMF_LEAD_FORM_ENTRY_UNCERTAINTY", input.uncertainty ?? ""],
    ["PMF_LEAD_FORM_ENTRY_CONSENT", input.consent ? "yes" : "no"],
    ["PMF_LEAD_FORM_ENTRY_TIMESTAMP", input.timestamp],
    ["PMF_LEAD_FORM_ENTRY_SOURCE", input.source ?? ""],
  ];
  for (const [envName, value] of optional) {
    const id = entry(env, envName);
    if (id && value) params.set(id, value);
  }

  let target;
  try {
    target = new URL(formUrl);
  } catch {
    console.error(
      `PMF_LEAD_FORM_URL is not a valid URL (starts with "${formUrl.slice(0, 12)}…", length ${formUrl.length}). ` +
        "It must be the full https://docs.google.com/forms/d/e/.../formResponse address.",
    );
    return { ok: false, reason: "lead_capture_failed" };
  }
  if (target.protocol !== "https:" || !target.pathname.endsWith("/formResponse")) {
    console.error(
      `PMF_LEAD_FORM_URL looks wrong: host=${target.host} path=${target.pathname}. ` +
        "It must be https and end in /formResponse (not /viewform).",
    );
  }
  const badIds = [["PMF_LEAD_FORM_ENTRY_EMAIL", emailEntry], ...optional.map(([n]) => [n, entry(env, n)])]
    .filter(([, id]) => id && !/^entry\.\d+$/.test(id))
    .map(([n]) => n);
  if (badIds.length) console.error(`Entry IDs not in the form "entry.123456": ${badIds.join(", ")}`);

  try {
    const response = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      redirect: "follow",
    });
    if (response.status >= 200 && response.status < 400) return { ok: true, persisted: true };
    return { ok: false, reason: "lead_capture_failed", status: response.status };
  } catch (err) {
    console.error(`Google Form request threw: ${err && err.message ? err.message : String(err)}`);
    return { ok: false, reason: "lead_capture_failed" };
  }
}

// ---------------------------------------------------------------------------
// Output logging (optional): saves the GENERATED MAP to a second Google Form.
//
// The form has exactly four questions — email, by, at, json — so everything
// else travels inside the json column as one JSON document: the map the
// visitor saw, the answers behind it, and how it was produced. One column
// holds the whole record, and the sheet stays readable.
//
// Deliberately non-blocking and error-swallowing: it runs after the response is
// built, so a logging failure can never stop a visitor from seeing a map that
// was generated successfully. If PMF_MAP_FORM_URL is unset, this is a no-op.
// ---------------------------------------------------------------------------

const MAP_LOG_FIELDS = [
  ["PMF_MAP_ENTRY_EMAIL", "email"],
  ["PMF_MAP_ENTRY_GENERATED_BY", "generated_by"],
  ["PMF_MAP_ENTRY_TIMESTAMP", "timestamp"],
  ["PMF_MAP_ENTRY_RAW", "json"],
];

async function logMap(env, payload) {
  const formUrl = entry(env, "PMF_MAP_FORM_URL");
  const emailEntry = entry(env, "PMF_MAP_ENTRY_EMAIL");
  if (!formUrl || !emailEntry) return;

  const record = {
    email: payload.email,
    generated_by: payload.generated_by,
    model: payload.model,
    latency_ms: payload.latency_ms,
    generated_at: payload.timestamp,
    source: payload.source,
    consent: payload.consent ? "yes" : "no",
    answers: payload.answers,
    map: payload.map,
  };

  const values = {
    email: payload.email,
    generated_by: payload.generated_by,
    timestamp: payload.timestamp,
    json: JSON.stringify(record),
  };

  const params = new URLSearchParams();
  for (const [envName, key] of MAP_LOG_FIELDS) {
    const id = entry(env, envName);
    const text = String(values[key] ?? "");
    if (id && text) params.set(id, text);
  }

  let target;
  try {
    target = new URL(formUrl);
  } catch {
    console.error(
      `PMF_MAP_FORM_URL is not a valid URL (starts with "${formUrl.slice(0, 12)}…", length ${formUrl.length}). ` +
        "Map logging skipped.",
    );
    return;
  }
  if (target.protocol !== "https:" || !target.pathname.endsWith("/formResponse")) {
    console.error(
      `PMF_MAP_FORM_URL looks wrong: host=${target.host} path=${target.pathname}. ` +
        "It must be https and end in /formResponse (not /viewform). Map logging skipped.",
    );
    return;
  }
  const badIds = MAP_LOG_FIELDS.map(([n]) => [n, entry(env, n)])
    .filter(([, id]) => id && !/^entry\.\d+$/.test(id))
    .map(([n]) => n);
  if (badIds.length) console.error(`Map-log entry IDs not in the form "entry.123456": ${badIds.join(", ")}`);

  try {
    const response = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      redirect: "follow",
    });
    if (response.status >= 200 && response.status < 400) {
      console.info(
        `pmf-evaluator map logged generated_by=${payload.generated_by} json_chars=${values.json.length}`,
      );
      return;
    }
    const html = await response.text().catch(() => "");
    const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "unknown";
    const required = /This is a required question/i.test(html);
    console.error(
      `Map-log form rejected the save [${response.status}]. Form title: "${title.trim()}". ` +
        (required
          ? "Reason: a required question in that form got no answer — check PMF_MAP_ENTRY_EMAIL matches it."
          : "Reason not stated by Google."),
    );
  } catch (err) {
    console.error(`Map-log request threw: ${err && err.message ? err.message : String(err)}`);
  }
}


// ---------------------------------------------------------------------------
// Gemini generation
// ---------------------------------------------------------------------------

function responseSchema() {
  const element = {
    type: "OBJECT",
    properties: {
      summary: { type: "STRING" },
      status: { type: "STRING", enum: PMF_STATUSES },
      supporting_input: { type: "STRING" },
      what_remains_unknown: { type: "STRING" },
    },
    required: ["summary", "status", "supporting_input", "what_remains_unknown"],
    propertyOrdering: ["summary", "status", "supporting_input", "what_remains_unknown"],
  };
  return {
    type: "OBJECT",
    properties: {
      opportunity_summary: { type: "STRING" },
      elements: {
        type: "OBJECT",
        properties: {
          technology: element,
          audience_need: element,
          willingness_to_pay: element,
          founder_expertise: element,
        },
        required: ["technology", "audience_need", "willingness_to_pay", "founder_expertise"],
      },
      interesting_hypothesis: { type: "STRING" },
      key_uncertainty: { type: "STRING" },
      next_experiment: {
        type: "OBJECT",
        properties: {
          action: { type: "STRING" },
          target: { type: "STRING" },
          question_or_observation: { type: "STRING" },
          meaningful_evidence: { type: "STRING" },
        },
        required: ["action", "target", "question_or_observation", "meaningful_evidence"],
        propertyOrdering: ["action", "target", "question_or_observation", "meaningful_evidence"],
      },
      remaining_unknowns: { type: "ARRAY", items: { type: "STRING" } },
      limitations: { type: "STRING" },
    },
    required: [
      "opportunity_summary",
      "elements",
      "interesting_hypothesis",
      "key_uncertainty",
      "next_experiment",
      "remaining_unknowns",
      "limitations",
    ],
    propertyOrdering: [
      "opportunity_summary",
      "elements",
      "interesting_hypothesis",
      "key_uncertainty",
      "next_experiment",
      "remaining_unknowns",
      "limitations",
    ],
  };
}

function systemPrompt() {
  return [
    "You produce a PMF Opportunity Map for founders using the Product Market Fit Primer's framework.",
    "",
    "Hard rules:",
    "1. Use only facts the founder supplied, plus cautious inferences you explicitly label as inferences.",
    "2. Separate founder-provided descriptions, reported evidence, assumptions, inferences and unknowns.",
    "3. Never invent validation, customer feedback, traction, market size, pricing, revenue or willingness to pay.",
    "4. Never claim the business has or lacks product-market fit.",
    "5. Never give a numerical PMF score, percentage probability of success or a pass/fail verdict.",
    "6. Keep the four framework elements exactly: Technology, Audience Need, Willingness to Pay, Founder Expertise.",
    "7. Adapt interpretation and the suggested experiment to the founder's stage.",
    "8. Identify ONE consequential uncertainty, not a list of every conceivable concern.",
    "9. Suggest ONE practical experiment with a specific target, action, observation and evidence criterion.",
    "10. Make clear that evidence criteria are ways to investigate a hypothesis, not universal success thresholds.",
    "11. Explicitly acknowledge important missing information.",
    "12. Avoid generic advice, motivational language, excessive caveats and lengthy output. Write compact, concrete, plain sentences suitable for a mobile screen.",
    "",
    "The four elements must use these exact status labels, chosen descriptively (they are not grades):",
    "Described, Assumed, Evidence provided, Unverified, Needs exploration.",
    "Treat any multiple-choice answer the founder selected as self-reported information, never as independently verified evidence.",
    "Do not treat an intersection of the four elements as proof of product-market fit.",
    "If the founder's input is vague, say what is missing instead of filling gaps with plausible-sounding specifics.",
    "Keep each summary and field under roughly 60 words. remaining_unknowns: 3 to 5 short items.",
  ].join("\n");
}

function userPrompt(answers) {
  const uncertainty = uncertaintyLabel(answers);
  return [
    "Founder inputs for the PMF Opportunity Map:",
    "",
    `PRODUCT_DESCRIPTION: ${answers.product}`,
    `FOUNDER_STAGE: ${STAGE_LABELS[answers.stage]}`,
    `AUDIENCE_AND_PROBLEM: ${answers.audience}`,
    `FOUNDER_EXPERTISE: ${answers.expertise}`,
    `REPORTED_EVIDENCE (self-selected option, self-reported, stage-adaptive): "${evidenceLabel(answers)}"`,
    `BIGGEST_UNCERTAINTY: ${uncertainty ? uncertainty : "not provided"}`,
    "",
    "Generate the PMF Opportunity Map as structured JSON per the schema. Ground every statement in the inputs above; label anything beyond them as an inference.",
  ].join("\n");
}

async function generateMap(env, answers) {
  const apiKey = env.GEMINI_API_KEY;
  const model = env.PMF_GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const startedAt = Date.now();
  if (!apiKey) return { ok: false, reason: "gemini_key_missing", latencyMs: 0, model };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents: [{ role: "user", parts: [{ text: userPrompt(answers) }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: responseSchema(),
        },
      }),
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`Gemini request failed [${response.status}]: ${body.slice(0, 300)}`);
      return { ok: false, reason: `gemini_http_${response.status}`, latencyMs, model, status: response.status };
    }

    const payload = await response.json();
    if (payload.promptFeedback?.blockReason) {
      return { ok: false, reason: `gemini_blocked_${payload.promptFeedback.blockReason}`, latencyMs, model };
    }
    const text = (payload.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) return { ok: false, reason: "gemini_empty_output", latencyMs, model };

    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, reason: "gemini_malformed_json", latencyMs, model };
    }
    if (!validMap(raw)) {
      console.error("Gemini output failed schema validation");
      return { ok: false, reason: "gemini_schema_invalid", latencyMs, model };
    }
    return { ok: true, map: raw, model, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const reason = error instanceof Error && error.name === "AbortError" ? "gemini_timeout" : "gemini_request_error";
    return { ok: false, reason, latencyMs, model };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Deterministic fallback map (port of fallback.server.ts)
// ---------------------------------------------------------------------------

const NOT_SURE_HINTS = ["not sure", "no idea", "don't know", "dont know", "unclear", "uncertain", "tbd"];

function saysNotSure(text) {
  const t = text.toLowerCase();
  return NOT_SURE_HINTS.some((h) => t.includes(h)) || t.trim().length < 8;
}

function buildFallbackMap(answers) {
  const ev = evidenceLabel(answers);
  const uncertainty = uncertaintyLabel(answers);
  const stageLabel = STAGE_LABELS[answers.stage];
  const expertiseUnclear = saysNotSure(answers.expertise);

  const willingnessStatus =
    answers.stage === "paying" && answers.evidence >= 2
      ? "Evidence provided"
      : answers.stage === "launched" || answers.stage === "paying"
        ? "Unverified"
        : "Needs exploration";

  return {
    opportunity_summary:
      `You describe working on: ${answers.product} ` +
      `You say it is for: ${answers.audience} ` +
      `Your current stage is: ${stageLabel}. This summary restates what you entered; ` +
      `it has not been independently checked.`,
    elements: {
      technology: {
        summary:
          "Technology covers what you can build or deliver. You described your product as: " +
          `${answers.product} What remains to be confirmed is which capability is distinctive ` +
          "rather than simply available.",
        status: "Described",
        supporting_input: `Your product description: "${answers.product.slice(0, 400)}"`,
        what_remains_unknown:
          "Whether the technical approach is distinctive, and what building or delivering it realistically requires.",
      },
      audience_need: {
        summary:
          "Audience Need covers who has a meaningful problem and in what context. You said the product is for: " +
          `${answers.audience} Your reported evidence about the problem: "${ev}"`,
        status: answers.evidence >= 2 ? "Evidence provided" : "Assumed",
        supporting_input: `Your audience and problem statement: "${answers.audience.slice(0, 400)}"`,
        what_remains_unknown:
          "Whether a specific buyer experiences this problem in a specific situation, and how they handle it today.",
      },
      willingness_to_pay: {
        summary:
          "Willingness to Pay covers whether solving the problem is valuable enough for someone to pay. " +
          `Your reported evidence: "${ev}" A self-reported answer is not independent confirmation of payment behaviour.`,
        status: willingnessStatus,
        supporting_input: `Your stage (${stageLabel}) and evidence answer: "${ev}"`,
        what_remains_unknown:
          "Who would authorise payment, what the problem costs them today, and what they would consider a fair price.",
      },
      founder_expertise: {
        summary: expertiseUnclear
          ? "Founder Expertise covers the knowledge, access and capabilities you bring. You have not yet articulated a specific advantage, so this element needs exploration."
          : `Founder Expertise covers the knowledge, access and capabilities you bring. You described: ${answers.expertise}`,
        status: expertiseUnclear ? "Needs exploration" : "Described",
        supporting_input: `Your expertise statement: "${answers.expertise.slice(0, 400)}"`,
        what_remains_unknown: expertiseUnclear
          ? "Which parts of your background, network or capabilities give you a credible advantage for this specific opportunity."
          : "Whether that advantage matters to this specific audience and problem rather than in general.",
      },
    },
    interesting_hypothesis:
      `Hypothesis (not validated): the audience you describe — ${answers.audience.slice(0, 220)} — ` +
      `may have a recurring problem that what you describe — ${answers.product.slice(0, 220)} — ` +
      "could address better than what they do today. Treating this as a hypothesis to investigate, not a finding.",
    key_uncertainty: uncertainty
      ? `You identified your biggest uncertainty as: ${uncertainty} This is the question whose answer is most likely to change your next decision.`
      : "You did not identify a biggest uncertainty, so the most consequential open question is whether a specific customer experiences this problem in a specific situation and acts on it.",
    next_experiment: nextExperiment(answers),
    remaining_unknowns: remainingUnknowns(answers, expertiseUnclear),
    limitations:
      "This is an initial assessment based only on the answers you provided. It is not an independent validation " +
      "of your business, not a determination of product-market fit, and not a score. Self-reported answers are not " +
      "verified evidence.",
  };
}

function nextExperiment(answers) {
  switch (answers.stage) {
    case "idea":
      return {
        action: "Run three retrospective problem interviews this week with people who match your intended audience.",
        target: "Three people in the audience you described who recently faced the situation your product addresses — not friends being polite.",
        question_or_observation:
          "Ask each person to walk you through the last time the problem came up: what they did about it, what it cost them, and what they tried first.",
        meaningful_evidence:
          "At least two of the three describe specific recent instances of the problem, what they did in response, and what it cost them in time, money or effort — without you prompting them.",
      };
    case "building":
      return {
        action: "Put a working or sketched version of your product in front of three potential customers and ask for a concrete commitment.",
        target: "Three potential customers from the audience you described who currently experience the problem.",
        question_or_observation:
          "After they react to the prototype, ask whether they would commit something meaningful now — time, data, a pilot slot, or money — and observe what they actually do, not what they say.",
        meaningful_evidence:
          "At least one person commits a meaningful resource (time, data, access or money) within a week, rather than only expressing interest.",
      };
    case "launched":
      return {
        action: "Review your funnel numbers and interview five visitors or signups who did not convert.",
        target: "Your last 30 days of acquisition data, plus five people who showed interest but did not pay or return.",
        question_or_observation:
          "For non-converters: what they expected, what they compared you against, and what stopped them. In the data: where interest turns into drop-off.",
        meaningful_evidence:
          "You can name the single step where most interested people stop, and non-converters describe the same specific obstacle in their own words.",
      };
    case "paying":
      return {
        action: "Interview five existing customers to establish who benefits most and why they stay.",
        target: "Five current customers: two who renewed or expanded, two who are quiet, and one who churned or asked to leave.",
        question_or_observation:
          "Ask what outcome they can point to since adopting the product, what they would do without it, and who else they would recommend it to.",
        meaningful_evidence:
          "A specific customer group emerges whose outcome you can describe concretely, and at least two customers articulate the value unprompted.",
      };
  }
}

function remainingUnknowns(answers, expertiseUnclear) {
  const unknowns = [
    "Whether a specific buyer experiences the problem in a specific situation, based on direct observation rather than belief.",
  ];
  if (answers.stage === "idea" || answers.stage === "building") {
    unknowns.push("Whether solving the problem creates enough economic value for someone to pay for a solution.");
  }
  if (answers.stage === "launched" || answers.stage === "paying") {
    unknowns.push("What drives conversion and repeat use today, and which customers genuinely benefit.");
  }
  if (answers.uncertainty == null) {
    unknowns.push("Which uncertainty worries you most — naming it would sharpen what to investigate next.");
  }
  if (expertiseUnclear) {
    unknowns.push("What specific advantage you bring to this opportunity.");
  }
  unknowns.push("Independent evidence for anything you have reported so far.");
  return unknowns.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Request handler (port of evaluator.server.ts handleEvaluate)
// ---------------------------------------------------------------------------

async function handleEvaluate(request, env, ctx) {
  const cors = corsHeaders(request, env);
  if (!originAllowed(request, env)) {
    return json({ error: "origin_not_allowed" }, 403, cors);
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413, cors);
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return json({ error: "invalid_request" }, 400, cors);
  }
  if (text.length > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413, cors);
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400, cors);
  }

  const parsed = validateRequest(raw);
  if (!parsed.ok) {
    return json({ error: "invalid_input", fields: parsed.fields }, 400, cors);
  }
  const input = parsed.input;

  if (rateLimited(clientIp(request))) {
    return json({ error: "rate_limited", message: "Too many requests. Please try again later." }, 429, cors);
  }

  // Lead persistence happens before generation: a visitor must be actually
  // recorded before we spend inference. Failures surface visibly.
  const lead = await persistLead(env, {
    email: input.email,
    consent: input.consent,
    stage: STAGE_LABELS[input.answers.stage],
    evidence: evidenceLabel(input.answers),
    product: input.answers.product,
    audience: input.answers.audience,
    expertise: input.answers.expertise,
    uncertainty: uncertaintyLabel(input.answers),
    source: input.meta?.source ?? "",
    timestamp: new Date().toISOString(),
  });
  if (!lead.ok) {
    console.error(`pmf-evaluator lead persistence failed: ${lead.reason}${lead.status ? ` [${lead.status}]` : ""}`);
    const configured = leadCaptureConfigured(env);
    return json(
      {
        error: lead.reason,
        message: configured
          ? "We could not record your email. Nothing was generated and no email was saved — please try again."
          : "Email capture is not configured for this deployment. No email was saved and no map was generated.",
      },
      configured ? 502 : 503,
      cors,
    );
  }

  let map;
  let source = "fallback";
  let model = "";
  const generation = await generateMap(env, input.answers);
  console.info(
    `pmf-evaluator generation ${generation.ok ? "ok" : generation.reason} model=${generation.model} latency_ms=${generation.latencyMs}`,
  );
  if (generation.ok) {
    map = generation.map;
    source = "gemini";
    model = generation.model;
  } else {
    map = buildFallbackMap(input.answers);
    model = generation.model;
  }

  const body = { map, meta: { source, model, lead_persisted: true, generated_at: new Date().toISOString() } };

  // Output logging is best-effort and happens after the response is built: a
  // map that generated successfully must reach the visitor even if the log
  // form is misconfigured, rate-limited or unreachable.
  const logged = logMap(env, {
    email: input.email,
    consent: input.consent,
    answers: {
      stage: STAGE_LABELS[input.answers.stage],
      evidence: evidenceLabel(input.answers),
      uncertainty: uncertaintyLabel(input.answers),
      product: input.answers.product,
      audience: input.answers.audience,
      expertise: input.answers.expertise,
    },
    source: input.meta?.source ?? "",
    map,
    generated_by: source,
    model,
    latency_ms: generation.latencyMs,
    timestamp: body.meta.generated_at,

  }).catch((err) => {
    console.error(`pmf-evaluator map logging threw: ${err && err.message ? err.message : String(err)}`);
  });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(logged);

  return json(body, 200, cors);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method === "POST") {
      return handleEvaluate(request, env, ctx);
    }
    return json({ error: "method_not_allowed" }, 405, corsHeaders(request, env));
  },
};
