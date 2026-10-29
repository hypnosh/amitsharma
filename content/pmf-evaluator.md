---
title: "PMF Evaluator"
description: "Answer a few short questions about your idea, your customers and what you know so far. Get a personalised PMF Opportunity Map with the assumptions worth testing and one practical next step."
layout: "pmf-evaluator"
date: 2026-10-28

seo:
  title: "PMF Evaluator — Understand your product opportunity"
  description: "A free two-minute PMF Opportunity Map: what you know, what remains uncertain, and one practical next step. No PMF score or pass/fail verdict."
  og_type: "website"
  og_title: "PMF Evaluator — Understand your product opportunity"
  og_description: "A free two-minute PMF Opportunity Map: what you know, what remains uncertain, and one practical next step."
  twitter_card: "summary"

# All editorial copy and configuration for the evaluator lives here.
# api_base must point at the deployment hosting /api/public/pmf/evaluate.
# privacy_url: set to the site's privacy notice URL (the email-step link
# hides itself while empty). primer_url must be a verified destination.
evaluator:
  api_base: "https://project--059acffb-f718-4bdd-a002-a940184d0cc0.lovable.app"
  primer_url: "https://amitsharma.tech/product-market-fit-primer/"
  privacy_url: "https://amitsharma.tech/privacy/"
  source: "amitsharma.tech/pmf-evaluator"
  copy:
    intro:
      headline: "Understand your product opportunity. Find out what to investigate next."
      support: "Answer a few short questions about your idea, your customers and what you know so far. Get a personalised PMF Opportunity Map with the assumptions worth testing and one practical next step."
      cta: "Build my PMF Opportunity Map"
      reassurance:
        - "Free to use."
        - "Takes about two minutes."
        - "No PMF score or pass/fail verdict."
        - "Useful even if you are still exploring an idea."
    steps:
      q1:
        label: "What are you building, or considering building?"
        help: "Describe the product, the problem it addresses and how it works. It is fine if you are still figuring it out."
        placeholder: "e.g. A tool that helps insurance brokers compare policies for small-business clients…"
      q2:
        label: "Where are you in the journey?"
        options:
          - label: "Idea / pre-build"
            description: "Exploring an opportunity, not built yet."
          - label: "Building / prototype"
            description: "Developing or testing an early version."
          - label: "Launched / acquiring customers"
            description: "The product is live, but demand, acquisition or conversion is unclear."
          - label: "Paying customers / growth challenges"
            description: "Have paying customers and need to understand what to improve."
      q3:
        label: "Who is this for, and what problem do they have?"
        help: "Say who you think it's for and what problem you believe they have. It's fine to be unsure — that is useful information too."
        placeholder: "e.g. Possibly small-business owners…, I'm not certain yet…"
      q4:
        label: "What relevant expertise, access or advantage do you bring?"
        help: "Consider industry knowledge, customer access, technical capabilities, operational experience or another relevant advantage. If nothing comes to mind yet, write “Not sure yet”."
        placeholder: "e.g. 10 years in commercial insurance distribution…"
      q5:
        label: "What have you observed so far?"
        question_by_stage:
          idea: "Have you observed this problem among potential customers?"
          building: "What evidence have you gathered from potential customers?"
          launched: "What have you observed about customer acquisition and payment?"
          paying: "What do you know about value from existing customers?"
        options_by_stage:
          idea:
            - "Not yet. It is currently an idea or belief."
            - "I have seen the problem or heard individual accounts."
            - "I have heard similar accounts from multiple potential customers."
            - "I have observed people taking action to solve it."
          building:
            - "Mostly our own assumptions so far."
            - "We have received feedback or expressions of interest."
            - "We have tested the prototype with potential customers."
            - "Some have committed time, data, money or another meaningful resource."
          launched:
            - "We do not yet have a clear picture."
            - "We attract interest, but conversion is weak or unclear."
            - "People use the product, but payment or repeat use is uncertain."
            - "We have paying customers, but acquisition or conversion is a challenge."
          paying:
            - "We have not established this clearly."
            - "We see usage, but are not sure which customers benefit most."
            - "We see repeat usage, renewal or other signs of ongoing value."
            - "Some customers renew, expand or refer others, and we have evidence of this."
      q6:
        label: "What is your biggest uncertainty right now?"
        options:
          - "Whether the problem is important enough."
          - "Which customers need this most."
          - "Whether our solution addresses the problem."
          - "Whether customers will pay enough."
          - "How to reach and acquire customers."
          - "Whether customers will keep using or paying for it."
          - "Whether we have a meaningful advantage."
          - "I am not sure yet."
        skip_label: "Skip this question"
    email:
      headline: "Your PMF Opportunity Map is next."
      support: "Enter your email address to generate your personalised map, including the assumptions worth testing and a practical next step."
      field_label: "Email address"
      placeholder: "you@example.com"
      cta: "Get my Opportunity Map"
      consent_label: "Send me occasional updates from Amit about new tools and writing. Optional — you don't need this to get your map."
      privacy_prefix: "We use your email only to generate your map and, if you opt in, to send you updates. See our"
      privacy_link_text: "privacy notice"
    progress:
      template: "Step {current} of {total}"
      next: "Continue"
      back: "Back"
    loading:
      title: "Building your PMF Opportunity Map…"
      note: "This takes a moment. Your map is generated from what you told us — no generic startup advice."
    errors:
      required: "Please choose an option to continue."
      min_length: "Please write at least {min} characters."
      invalid_email: "Please enter a valid email address."
      generic: "Something went wrong while generating your map. Nothing was saved — please try again."
      network: "We couldn't reach the service. Please check your connection and try again."
      rate_limited: "Too many attempts. Please wait a little while and try again."
    result:
      sections:
        as_described: "Your opportunity, as described"
        elements: "The four elements"
        hypothesis: "What looks interesting"
        uncertainty: "The most consequential uncertainty"
        experiment: "Your next experiment"
        unknowns: "What remains unknown"
        limitations: "Limitations"
      element_labels:
        technology: "Technology"
        audience_need: "Audience Need"
        willingness_to_pay: "Willingness to Pay"
        founder_expertise: "Founder Expertise"
      element_field_labels:
        supporting_input: "What you told us"
        unknown: "What remains unknown"
      experiment_labels:
        action: "What to do"
        target: "Whom to approach or what to examine"
        question_or_observation: "What to ask or observe"
        interpretation: "What different findings would suggest"
        meaningful_evidence: "What would count as meaningful evidence"
      copy_button: "Copy as plain text"
      copied_button: "Copied"
      print_button: "Print"
      fallback_note: "This map was built from your answers using our standard framework — the personalised generation service was unavailable, so the wording is deliberately cautious and generic."
      primer:
        headline: "You've identified what to investigate. Now work through it systematically."
        body: "The Product Market Fit Primer is a practical workbook that helps you develop hypotheses, assess the opportunity, conduct customer discovery, capture evidence, design experiments and synthesise what you learn."
        ai_note: "Its AI companion helps you work through the material, structure your reasoning and challenge assumptions. It cannot independently establish real-world evidence."
        price_label: "Price: ₹1,999"
        cta: "Explore the Product Market Fit Primer"
---

The evaluator runs entirely on this page; see the Primer landing page for the paid workbook.
