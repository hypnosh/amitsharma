/*
 * PMF Evaluator — stage-adaptive questionnaire + Opportunity Map renderer.
 * Dependency-free vanilla JS. All editorial copy is injected via the
 * `#pmf-evaluator-config` JSON script tag (Hugo front matter or app config),
 * so this file contains no hardcoded marketing copy.
 * Security: every dynamic string is written via textContent — no innerHTML.
 * Analytics: pushes funnel events to window.dataLayer (GA4/GTM) with
 * non-sensitive metadata only (never the email or free-text answers).
 */
(function () {
  "use strict";

  var STAGE_KEYS = ["idea", "building", "launched", "paying"];
  var TOTAL_STEPS = 7; // Q1..Q6 + email step

  var configEl = document.getElementById("pmf-evaluator-config");
  var root = document.getElementById("pmf-evaluator-root");
  if (!configEl || !root) return;

  var config;
  try {
    config = JSON.parse(configEl.textContent || "{}");
  } catch (e) {
    return;
  }
  var copy = config.copy || {};

  function h(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function field(labelText, helpText, inputEl, id) {
    var wrap = h("div", "pmf-field");
    var label = h("label", "pmf-label", labelText);
    label.setAttribute("for", id);
    wrap.appendChild(label);
    if (helpText) {
      var help = h("p", "pmf-help", helpText);
      help.id = id + "-help";
      inputEl.setAttribute("aria-describedby", help.id);
      wrap.appendChild(help);
    }
    inputEl.id = id;
    wrap.appendChild(inputEl);
    var err = h("p", "pmf-error");
    err.setAttribute("role", "alert");
    err.hidden = true;
    wrap.appendChild(err);
    return { wrap: wrap, err: err };
  }

  function showError(errEl, message) {
    errEl.textContent = message;
    errEl.hidden = false;
  }

  function clearError(errEl) {
    errEl.textContent = "";
    errEl.hidden = true;
  }

  /* ---------------- analytics ---------------- */

  var sessionId = null;
  try {
    sessionId = sessionStorage.getItem("pmf_evaluator_sid");
    if (!sessionId) {
      sessionId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + "-" + Math.random().toString(36).slice(2);
      sessionStorage.setItem("pmf_evaluator_sid", sessionId);
    }
  } catch (e) {
    sessionId = "anon";
  }

  function track(event, data) {
    var payload = {
      event: event,
      evaluator_session: sessionId,
      event_timestamp: new Date().toISOString()
    };
    if (data) {
      for (var k in data) {
        if (Object.prototype.hasOwnProperty.call(data, k)) payload[k] = data[k];
      }
    }
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
  }

  /* ---------------- state ---------------- */

  var state = {
    step: 0, // 0 = intro; 1..6 = Q1..Q6; 7 = email
    answers: { product: "", stage: "", audience: "", expertise: "", evidence: -1, uncertainty: null },
    email: "",
    consent: false,
    map: null,
    meta: null,
    started: false
  };

  function apiBase() {
    return config.apiBase || "";
  }

  function apiUrl() {
    return apiBase().replace(/\/$/, "") + "/api/public/pmf/evaluate";
  }

  /* ---------------- intro ---------------- */

  function renderIntro() {
    root.textContent = "";
    var sec = h("section", "pmf-panel pmf-intro");
    var inner = h("div", "pmf-intro-inner");
    inner.appendChild(h("h1", "pmf-h1", copy.intro.headline));
    inner.appendChild(h("p", "pmf-support", copy.intro.support));

    var cta = h("button", "pmf-button pmf-button-primary", copy.intro.cta);
    cta.type = "button";
    cta.addEventListener("click", function () {
      state.step = 1;
      state.started = true;
      track("evaluator_start");
      renderStep(1);
    });
    inner.appendChild(cta);

    var ul = h("ul", "pmf-reassurance");
    (copy.intro.reassurance || []).forEach(function (item) {
      ul.appendChild(h("li", null, item));
    });
    inner.appendChild(ul);
    sec.appendChild(inner);
    root.appendChild(sec);
    track("evaluator_view");
  }

  /* ---------------- progress ---------------- */

  function progressEl(current) {
    var wrap = h("div", "pmf-progress");
    var label = h("p", "pmf-progress-label");
    label.setAttribute("aria-live", "polite");
    label.textContent = copy.progress.template.replace("{current}", String(current)).replace("{total}", String(TOTAL_STEPS));
    var bar = h("div", "pmf-progress-bar");
    var fill = h("div", "pmf-progress-fill");
    fill.style.width = Math.round((current / TOTAL_STEPS) * 100) + "%";
    bar.appendChild(fill);
    wrap.appendChild(label);
    wrap.appendChild(bar);
    return wrap;
  }

  function navRow(onBack, onNext, nextLabel, nextDisabled) {
    var row = h("div", "pmf-nav");
    if (onBack) {
      var back = h("button", "pmf-button pmf-button-ghost", copy.progress.back);
      back.type = "button";
      back.addEventListener("click", onBack);
      row.appendChild(back);
    } else {
      row.appendChild(h("span"));
    }
    if (!nextLabel) return row;
    var next = h("button", "pmf-button pmf-button-primary", nextLabel);
    next.type = "button";
    if (nextDisabled) next.disabled = true;
    next.addEventListener("click", onNext);
    row.appendChild(next);
    return row;
  }

  /* ---------------- steps ---------------- */

  function goBack() {
    if (state.step <= 1) {
      state.step = 0;
      renderIntro();
      return;
    }
    state.step -= 1;
    if (state.step >= 1 && state.step <= 6) renderStep(state.step);
    else if (state.step === 0) renderIntro();
  }

  function advance() {
    state.step += 1;
    if (state.step <= 6) renderStep(state.step);
    else renderEmail();
  }

  function textAreaStep(stepNo, id, answerKey, minLen, onChanged) {
    var q = stepNo === 1 ? copy.steps.q1 : stepNo === 3 ? copy.steps.q3 : copy.steps.q4;
    var ta = document.createElement("textarea");
    ta.className = "pmf-textarea";
    ta.rows = stepNo === 1 ? 5 : 4;
    ta.maxLength = 2000;
    ta.value = state.answers[answerKey] || "";
    if (q.placeholder) ta.placeholder = q.placeholder;
    var f = field(q.label, q.help, ta, id);
    var counter = h("p", "pmf-counter", ta.value.length + " / 2000");
    ta.addEventListener("input", function () {
      state.answers[answerKey] = ta.value;
      counter.textContent = ta.value.length + " / 2000";
      clearError(f.err);
      if (onChanged) onChanged();
    });
    f.wrap.appendChild(counter);

    function validate() {
      if (ta.value.trim().length < minLen) {
        showError(f.err, copy.errors.min_length.replace("{min}", String(minLen)));
        return false;
      }
      return true;
    }

    return { wrap: f.wrap, err: f.err, validate: validate, focus: ta };
  }

  function radioStep(id, legendText, options, name, checkedIndex, onSelect) {
    var fs = h("fieldset", "pmf-fieldset");
    var legend = h("legend", "pmf-label", legendText);
    fs.appendChild(legend);
    var err = h("p", "pmf-error");
    err.setAttribute("role", "alert");
    err.hidden = true;
    options.forEach(function (opt, i) {
      var label = h("label", "pmf-radio");
      var input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = String(i);
      input.checked = checkedIndex === i;
      var text = typeof opt === "string" ? opt : opt.label;
      var desc = typeof opt === "string" ? null : opt.description;
      label.appendChild(input);
      var textWrap = h("span", "pmf-radio-text");
      textWrap.appendChild(h("span", "pmf-radio-label", text));
      if (desc) textWrap.appendChild(h("span", "pmf-radio-desc", desc));
      label.appendChild(textWrap);
      input.addEventListener("change", function () {
        clearError(err);
        if (onSelect) onSelect(i);
      });
      fs.appendChild(label);
    });
    fs.appendChild(err);
    return { wrap: fs, err: err, name: name };
  }

  function renderStep(stepNo) {
    root.textContent = "";
    var sec = h("section", "pmf-panel");
    sec.appendChild(progressEl(stepNo));

    var body = h("div", "pmf-step-body");
    var firstInput = null;
    var validate = function () {
      return true;
    };

    if (stepNo === 1 || stepNo === 3 || stepNo === 4) {
      var key = stepNo === 1 ? "product" : stepNo === 3 ? "audience" : "expertise";
      var minLen = stepNo === 4 ? 3 : 10;
      var t = textAreaStep(stepNo, "pmf-q" + stepNo, key, minLen, null);
      body.appendChild(t.wrap);
      validate = t.validate;
      firstInput = t.focus;
    } else if (stepNo === 2) {
      var stageOptions = STAGE_KEYS.map(function (k) {
        var idx = STAGE_KEYS.indexOf(k);
        var opt = copy.steps.q2.options[idx] || {};
        return { label: opt.label || k, description: opt.description, key: k };
      });
      var prevStage = state.answers.stage;
      var rs = radioStep("pmf-q2", copy.steps.q2.label, stageOptions, "pmf-stage",
        STAGE_KEYS.indexOf(state.answers.stage),
        function (i) {
          var newStage = STAGE_KEYS[i];
          if (newStage !== prevStage && state.answers.evidence !== -1) {
            state.answers.evidence = -1; // options differ per stage
          }
          state.answers.stage = newStage;
          prevStage = newStage;
        });
      rs.wrap.querySelectorAll("input").forEach(function (input, i) {
        input.dataset.stage = STAGE_KEYS[i];
      });
      body.appendChild(rs.wrap);
      validate = function () {
        if (state.answers.stage === "") {
          showError(rs.err, copy.errors.required);
          return false;
        }
        return true;
      };
      firstInput = rs.wrap.querySelector("input");
    } else if (stepNo === 5) {
      var stageKey = state.answers.stage || "idea";
      var q5 = copy.steps.q5;
      var question = (q5.question_by_stage && q5.question_by_stage[stageKey]) || q5.label;
      var opts = (q5.options_by_stage && q5.options_by_stage[stageKey]) || [];
      var ev = radioStep("pmf-q5", question, opts, "pmf-evidence", state.answers.evidence, function (i) {
        state.answers.evidence = i;
      });
      body.appendChild(ev.wrap);
      validate = function () {
        if (state.answers.evidence < 0) {
          showError(ev.err, copy.errors.required);
          return false;
        }
        return true;
      };
      firstInput = ev.wrap.querySelector("input");
    } else if (stepNo === 6) {
      var q6 = copy.steps.q6;
      var options = (q6.options || []).slice();
      var us = radioStep("pmf-q6", q6.label, options, "pmf-uncertainty",
        state.answers.uncertainty == null ? -1 : state.answers.uncertainty,
        function (i) {
          state.answers.uncertainty = i;
        });
      body.appendChild(us.wrap);
      var skip = h("button", "pmf-skip", q6.skip_label);
      skip.type = "button";
      skip.addEventListener("click", function () {
        state.answers.uncertainty = null;
        var inputs = us.wrap.querySelectorAll("input");
        for (var i = 0; i < inputs.length; i++) inputs[i].checked = false;
        advance();
      });
      body.appendChild(us.wrap);
      body.appendChild(skip);
      validate = function () {
        return true;
      };
    }

    sec.appendChild(body);
    sec.appendChild(navRow(stepNo > 1 ? goBack : null, function () {
      if (!validate()) return;
      advance();
    }, copy.progress.next, false));
    root.appendChild(sec);
    if (firstInput && firstInput.focus) {
      try {
        firstInput.focus({ preventScroll: true });
      } catch (e) {
        /* ignore */
      }
    }
  }

  /* ---------------- email step ---------------- */

  function renderEmail() {
    root.textContent = "";
    track("evaluator_email_step_view");
    var sec = h("section", "pmf-panel");
    sec.appendChild(progressEl(7));
    var inner = h("div", "pmf-step-body");
    inner.appendChild(h("h2", "pmf-h2", copy.email.headline));
    inner.appendChild(h("p", "pmf-support", copy.email.support));

    var input = document.createElement("input");
    input.type = "email";
    input.className = "pmf-input";
    input.autocomplete = "email";
    input.value = state.email;
    input.placeholder = copy.email.placeholder || "you@example.com";
    var f = field(copy.email.field_label || "Email address", null, input, "pmf-email");

    var consentWrap = h("div", "pmf-consent");
    var consentLabel = h("label", "pmf-checkbox");
    var consent = document.createElement("input");
    consent.type = "checkbox";
    consent.checked = state.consent;
    consent.addEventListener("change", function () {
      state.consent = consent.checked;
    });
    consentLabel.appendChild(consent);
    consentLabel.appendChild(h("span", null, copy.email.consent_label));
    consentWrap.appendChild(consentLabel);
    if (config.privacyUrl) {
      var p = h("p", "pmf-privacy-note", copy.email.privacy_prefix + " ");
      var a = h("a", "pmf-link", copy.email.privacy_link_text);
      a.href = config.privacyUrl;
      a.target = "_blank";
      a.rel = "noopener";
      p.appendChild(a);
      p.appendChild(document.createTextNode("."));
      consentWrap.appendChild(p);
    }
    f.wrap.appendChild(consentWrap);
    inner.appendChild(f.wrap);

    var submit = h("button", "pmf-button pmf-button-primary pmf-button-block", copy.email.cta);
    submit.type = "button";
    submit.addEventListener("click", function () {
      var email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError(f.err, copy.errors.invalid_email);
        return;
      }
      clearError(f.err);
      state.email = email;
      state.consent = consent.checked;
      track("evaluator_email_submit");
      generate();
    });
    var err = h("p", "pmf-error pmf-error-block");
    err.setAttribute("role", "alert");
    err.hidden = true;
    inner.appendChild(submit);
    inner.appendChild(err);

    sec.appendChild(inner);
    sec.appendChild(navRow(goBack, null, "", true));
    root.appendChild(sec);
    try {
      input.focus({ preventScroll: true });
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------------- generation ---------------- */

  function renderLoading() {
    root.textContent = "";
    var sec = h("section", "pmf-panel pmf-loading");
    var spinner = h("div", "pmf-spinner");
    spinner.setAttribute("aria-hidden", "true");
    sec.appendChild(spinner);
    var title = h("p", "pmf-loading-title", copy.loading.title);
    title.setAttribute("aria-live", "polite");
    sec.appendChild(title);
    sec.appendChild(h("p", "pmf-support", copy.loading.note));
    root.appendChild(sec);
  }

  function generate() {
    var startedAt = Date.now();
    renderLoading();
    var payload = {
      email: state.email,
      consent: state.consent,
      answers: {
        product: state.answers.product.trim(),
        stage: state.answers.stage,
        audience: state.answers.audience.trim(),
        expertise: state.answers.expertise.trim(),
        evidence: state.answers.evidence,
        uncertainty: state.answers.uncertainty == null ? null : state.answers.uncertainty
      },
      meta: { source: config.source || "pmf-evaluator" }
    };

    fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        var wait = Math.max(0, 600 - (Date.now() - startedAt));
        return response
          .json()
          .catch(function () {
            return { error: "network_error" };
          })
          .then(function (data) {
            return { response: response, data: data };
          })
          .then(function (r) {
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(r);
              }, wait);
            });
          });
      })
      .then(function (r) {
        if (r.response.ok && r.data && r.data.map) {
          state.map = r.data.map;
          state.meta = r.data.meta || {};
          track("evaluator_complete", { generation: state.meta.source || "unknown" });
          renderResult();
        } else {
          var message = (r.data && r.data.message) || copy.errors.generic;
          if (r.response.status === 429) message = (r.data && r.data.message) || copy.errors.rate_limited;
          track("evaluator_generation_error", { status: r.response.status });
          renderEmailError(message);
        }
      })
      .catch(function () {
        track("evaluator_generation_error", { status: 0 });
        renderEmailError(copy.errors.network);
      });
  }

  function renderEmailError(message) {
    var errEl = root.querySelector(".pmf-error-block");
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
      var panels = root.querySelectorAll(".pmf-panel");
      if (panels.length) {
        var buttons = panels[0].querySelectorAll("button");
        for (var i = 0; i < buttons.length; i++) buttons[i].disabled = false;
      }
      var emailPanel = root.querySelector(".pmf-panel .pmf-step-body");
      if (emailPanel && !emailPanel.querySelector(".pmf-input")) renderEmail();
      return;
    }
    renderEmail();
    errEl = root.querySelector(".pmf-error-block");
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
    }
  }

  /* ---------------- result ---------------- */

  function elementCard(key, element) {
    var card = h("article", "pmf-element");
    var head = h("div", "pmf-element-head");
    head.appendChild(h("h3", "pmf-element-title", copy.result.element_labels[key]));
    var chip = h("span", "pmf-status", element.status);
    chip.setAttribute("data-status", element.status);
    head.appendChild(chip);
    card.appendChild(head);
    card.appendChild(h("p", "pmf-element-summary", element.summary));
    if (element.supporting_input) {
      var inputLine = h("p", "pmf-element-input");
      inputLine.appendChild(h("strong", null, copy.result.element_field_labels.supporting_input + ": "));
      inputLine.appendChild(document.createTextNode(element.supporting_input));
      card.appendChild(inputLine);
    }
    if (element.what_remains_unknown) {
      var unknownLine = h("p", "pmf-element-unknown");
      unknownLine.appendChild(h("strong", null, copy.result.element_field_labels.unknown + ": "));
      unknownLine.appendChild(document.createTextNode(element.what_remains_unknown));
      card.appendChild(unknownLine);
    }
    return card;
  }

  function resultSection(title, contentBuilder) {
    var sec = h("section", "pmf-result-section");
    sec.appendChild(h("h2", "pmf-h2", title));
    contentBuilder(sec);
    return sec;
  }

  function authorBlock() {
    var a = copy.result && copy.result.author;
    if (!a || !a.headline || !config.consultingUrl) return null;
    var sec = h("section", "pmf-author pmf-result-section");
    sec.appendChild(h("h2", "pmf-h2", a.headline));
    (a.lines || []).forEach(function (line) {
      if (line) sec.appendChild(h("p", "pmf-paragraph", line));
    });
    var link = h("a", "pmf-author-cta", a.cta || "Talk to Amit");
    link.href = config.consultingUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.addEventListener("click", function () {
      track("consulting_cta_click", { destination: "consulting_call" });
    });
    sec.appendChild(link);
    return sec;
  }

  function renderResult() {
    root.textContent = "";
    var map = state.map;
    var isFallback = state.meta && state.meta.source === "fallback";

    var wrap = h("article", "pmf-result");
    wrap.setAttribute("aria-live", "polite");

    var author = authorBlock();
    if (author) wrap.appendChild(author);

    wrap.appendChild(resultSection(copy.result.sections.as_described, function (sec) {
      sec.appendChild(h("p", "pmf-paragraph", map.opportunity_summary));
    }));

    wrap.appendChild(resultSection(copy.result.sections.elements, function (sec) {
      ["technology", "audience_need", "willingness_to_pay", "founder_expertise"].forEach(function (key) {
        sec.appendChild(elementCard(key, map.elements[key]));
      });
    }));

    wrap.appendChild(resultSection(copy.result.sections.hypothesis, function (sec) {
      sec.appendChild(h("p", "pmf-paragraph", map.interesting_hypothesis));
    }));

    wrap.appendChild(resultSection(copy.result.sections.uncertainty, function (sec) {
      sec.appendChild(h("p", "pmf-paragraph", map.key_uncertainty));
    }));

    wrap.appendChild(resultSection(copy.result.sections.experiment, function (sec) {
      var exp = map.next_experiment;
      var dl = h("dl", "pmf-experiment");
      var rows = [
        [copy.result.experiment_labels.action, exp.action],
        [copy.result.experiment_labels.target, exp.target],
        [copy.result.experiment_labels.question_or_observation, exp.question_or_observation],
        [copy.result.experiment_labels.interpretation, exp.interpretation],
        [copy.result.experiment_labels.meaningful_evidence, exp.meaningful_evidence]
      ];
      rows.forEach(function (r) {
        if (!r[1]) return;
        var dt = h("dt", null, r[0]);
        var dd = h("dd", null, r[1]);
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
      sec.appendChild(dl);
    }));

    wrap.appendChild(resultSection(copy.result.sections.unknowns, function (sec) {
      var ul = h("ul", "pmf-unknowns");
      (map.remaining_unknowns || []).forEach(function (item) {
        ul.appendChild(h("li", null, item));
      });
      sec.appendChild(ul);
    }));

    wrap.appendChild(resultSection(copy.result.sections.limitations, function (sec) {
      sec.appendChild(h("p", "pmf-paragraph pmf-limitations", map.limitations));
    }));

    if (isFallback) {
      wrap.insertBefore(h("p", "pmf-fallback-note", copy.result.fallback_note), wrap.firstChild);
    }

    var actions = h("div", "pmf-result-actions");
    var copyBtn = h("button", "pmf-button pmf-button-ghost", copy.result.copy_button);
    copyBtn.type = "button";
    copyBtn.addEventListener("click", function () {
      var text = mapToPlainText(map);
      var done = function () {
        copyBtn.textContent = copy.result.copied_button;
        setTimeout(function () {
          copyBtn.textContent = copy.result.copy_button;
        }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          fallbackCopy(text);
          done();
        });
      } else {
        fallbackCopy(text);
        done();
      }
    });
    actions.appendChild(copyBtn);

    var printBtn = h("button", "pmf-button pmf-button-ghost", copy.result.print_button);
    printBtn.type = "button";
    printBtn.addEventListener("click", function () {
      window.print();
    });
    actions.appendChild(printBtn);
    wrap.appendChild(actions);

    var primer = h("aside", "pmf-primer");
    primer.appendChild(h("h2", "pmf-h2", copy.result.primer.headline));
    primer.appendChild(h("p", "pmf-paragraph", copy.result.primer.body));
    primer.appendChild(h("p", "pmf-paragraph", copy.result.primer.ai_note));
    primer.appendChild(h("p", "pmf-price", copy.result.primer.price_label));
    var cta = h("a", "pmf-button pmf-button-primary pmf-button-block", copy.result.primer.cta);
    cta.href = config.primerUrl || "#";
    cta.target = "_blank";
    cta.rel = "noopener";
    cta.addEventListener("click", function () {
      track("primer_cta_click", { destination: "primer_page" });
    });
    primer.appendChild(cta);
    wrap.appendChild(primer);

    root.appendChild(wrap);
    try {
      wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      /* ignore */
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      /* ignore */
    }
    document.body.removeChild(ta);
  }

  function mapToPlainText(map) {
    var L = copy.result;
    var lines = [];
    lines.push("PMF OPPORTUNITY MAP");
    lines.push("");
    if (L.author && L.author.headline) {
      lines.push(L.author.headline);
      (L.author.lines || []).forEach(function (line) {
        if (line) lines.push(line);
      });
      if (config.consultingUrl) lines.push(L.author.cta + ": " + config.consultingUrl);
      lines.push("");
    }
    lines.push(L.sections.as_described.toUpperCase());
    lines.push(map.opportunity_summary);
    lines.push("");
    lines.push(L.sections.elements.toUpperCase());
    ["technology", "audience_need", "willingness_to_pay", "founder_expertise"].forEach(function (key) {
      var e = map.elements[key];
      lines.push("");
      lines.push(L.element_labels[key] + " [" + e.status + "]");
      lines.push(e.summary);
      if (e.supporting_input) lines.push(L.element_field_labels.supporting_input + ": " + e.supporting_input);
      if (e.what_remains_unknown) lines.push(L.element_field_labels.unknown + ": " + e.what_remains_unknown);
    });
    lines.push("");
    lines.push(L.sections.hypothesis.toUpperCase());
    lines.push(map.interesting_hypothesis);
    lines.push("");
    lines.push(L.sections.uncertainty.toUpperCase());
    lines.push(map.key_uncertainty);
    lines.push("");
    lines.push(L.sections.experiment.toUpperCase());
    lines.push(L.experiment_labels.action + ": " + map.next_experiment.action);
    lines.push(L.experiment_labels.target + ": " + map.next_experiment.target);
    lines.push(L.experiment_labels.question_or_observation + ": " + map.next_experiment.question_or_observation);
    if (map.next_experiment.interpretation) lines.push(L.experiment_labels.interpretation + ": " + map.next_experiment.interpretation);
    lines.push(L.experiment_labels.meaningful_evidence + ": " + map.next_experiment.meaningful_evidence);
    lines.push("");
    lines.push(L.sections.unknowns.toUpperCase());
    (map.remaining_unknowns || []).forEach(function (u) {
      lines.push("- " + u);
    });
    lines.push("");
    lines.push(L.sections.limitations.toUpperCase());
    lines.push(map.limitations);
    return lines.join("\n");
  }

  /* ---------------- boot ---------------- */

  renderIntro();
})();
