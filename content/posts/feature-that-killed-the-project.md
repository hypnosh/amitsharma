---
date: '2026-09-01T14:36:48+05:30'
draft: false
title: "The Feature That Killed the Project Wasn't a Bad Feature"
description: "A feature can be valuable and still be the wrong dependency. How adding video to our online poker project became the bottleneck that stopped everything else."
tags:
 - product management
 - product strategy
 - product scope
 - feature prioritization
 - MVP
 - dependencies
 - startup lessons
 - product development
 - software projects
 - decision making
---

Around 2020, a friend and I started building an online multiplayer poker application.

The idea was straightforward enough. Create a private table, invite your friends, sit down together and play Texas Hold'em in the browser. I had spent years playing poker professionally, so the game logic was familiar territory. We built the table, cards, player seating, multiplayer state and a fair amount of the poker engine. We had hand comparison working. My friend was working through pots and side pots, including the genuinely unpleasant edge cases created by multiple all-ins.

Then we decided the experience needed video.

This was not an unreasonable decision.

Poker is a social game. Much of the experience around a home game is not the cards themselves. It is reading reactions, talking rubbish, celebrating a ridiculous river card and watching someone pretend they don't care about losing a big pot.

If we were going to recreate the experience of playing poker with friends remotely, video felt like an obvious part of the product.

So we built it.

Or rather, we started building it.

We got video working in a prototype. We hired an intern to help with that part. We experimented with PeerJS and browser-based video connections. Individual pieces worked. But we couldn't get video working reliably enough as part of the actual application.

Meanwhile, the poker product itself was progressing.

And that's where we made the mistake.

We allowed video to become a dependency for the entire product.

## An important feature can still be the wrong thing to build now

Looking back, I don't think adding video was the mistake.

The mistake was treating the product as incomplete without it.

There is a difference.

Video was important to our vision of the ideal experience. It was not necessary to validate whether people would enjoy playing poker together through the application.

Those are two very different thresholds.

We could have built a functional private poker table where friends joined through a link and played together while talking on WhatsApp, Discord, Zoom or whatever else they already used. The poker experience could have been tested independently of whether we could also solve browser-based video conferencing.

Instead, we tied the success of one problem to the solution of another.

The result was predictable. The hardest unsolved subsystem became the bottleneck for everything else.

Eventually, I joined Coverfox. My co-founder, Pratik, got busier with his day job. The project lost momentum and was abandoned.

Not because we couldn't build poker.

Not because nobody wanted the product.

Not even because video was a bad idea.

We abandoned it because the thing we had not yet solved became more important than the things we had already built.

## The dependency question

This is a mistake product teams make surprisingly often.

A feature can be valuable and still not deserve to be on the critical path.

Imagine a product with three things:

1. The core user problem.
2. A feature that makes the experience significantly better.
3. A technically difficult subsystem needed for that feature.

The temptation is to treat all three as one product.

But they aren't.

The better question is: what happens if the difficult subsystem doesn't exist yet?

Can users still get value?

Can you still learn something important?

Can you still ship?

In our case, the answer was clearly yes.

The poker game could have existed without video. In fact, removing video would probably have made the product easier to test, easier to build and much easier to keep moving while we had limited time outside our day jobs.

We didn't see it that way at the time because video had become part of the picture in our heads.

And once a feature becomes part of the picture, removing it can feel like compromising the product.

Sometimes it is.

Sometimes it is simply removing an unnecessary dependency.

## What I'd do differently now

If I revive the project, I will probably remove video completely.

Not postpone it. Not put it in the roadmap. Remove it from the product definition.

The product is a private online poker table.

People can decide for themselves how they want to talk.

That sounds almost embarrassingly obvious now, but it is a useful reminder that product scope isn't only about deciding what to build. It is also about deciding what the rest of the product is allowed to depend on.

The feature that killed our project wasn't a bad feature.

It was just allowed to matter too soon.
