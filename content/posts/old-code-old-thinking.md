---
date: '2026-09-15T13:22:13+05:30'
draft: false
title: 'Old Code, Old Thinking'
---
I went back into some old code recently (_[The Feature That Killed the Project Wasn't a Bad Feature](https://www.amitsharma.tech/posts/feature-that-killed-the-project/)_), and found something interesting.

The code itself hasn't aged particularly well. That's probably inevitable. Dependencies are old, some things are half-built, and there are parts I'd approach very differently today.

But the thinking behind it has aged surprisingly well.

I'm still quite proud of the hand comparison logic I wrote. I've cited it on public forums a few times when I've come across someone building a poker app and struggling with hand evaluation.

The side-pot logic my friend worked on is another example. Reading it again, I could see the amount of thought that had gone into some genuinely ugly edge cases.

Even some of the architectural decisions still make sense to me. We had deliberately kept the game logic centralised, with a single function responsible for processing a player's bet and advancing the game state.

The project itself was abandoned for perfectly ordinary reasons. I joined Coverfox, my friend's workload increased, and the video component we'd brought an intern in to work on never really got beyond the prototype stage.

The code is probably not something I'd revive as-is.

But the thinking embedded in it is still useful.

That's something I've come to appreciate about old projects. Software has a short shelf life. Good problem-solving doesn't.

Sometimes an abandoned project is worth revisiting, not because you want to finish it, but because you want to remember how you thought when you built it.

