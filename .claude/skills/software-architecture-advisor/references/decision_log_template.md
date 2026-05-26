# Decision Log Template

Fill this in once per project. Save it alongside the project's source code (or in a personal notes file). Paste the filled-in block ABOVE the forcing meta-prompt at the start of any software conversation about that project.

The purpose is to answer the clarification gate's questions in advance, so the AI does not re-elicit the same constraints from you every session.

---

## Blank template (copy and fill)

```
DECISION LOG — <project name>

User count:                    1
Budget ceiling/month:          $0
Ops tolerance:                 zero — no servers I have to patch
Deployment preference ranked:  static > local CLI > single-binary > managed PaaS > self-hosted
Data sensitivity:              <e.g., personal-only, not shared>
Reversibility horizon:         <how long would I tolerate a wrong choice — weeks? months? years?>
Boring stack I already know:   <e.g., Python, vanilla HTML/CSS, SQLite>
Hard nos:                      <e.g., no AWS, no Kubernetes, no Docker for personal projects>

Notes:
 <any project-specific context the AI should know — e.g., "this is a one-off
  data migration, no users will ever interact with it"; or "this runs on my
  laptop, never on a server">
```

---

## Filled-in example (for reference)

```
DECISION LOG — habit-tracker

User count:                    1
Budget ceiling/month:          $0
Ops tolerance:                 zero — no servers I have to patch
Deployment preference ranked:  static > local CLI > single-binary > managed PaaS > self-hosted
Data sensitivity:              personal habits, not shared, OK in browser storage
Reversibility horizon:         weeks — I can rewrite this in a weekend if needed
Boring stack I already know:   HTML/CSS/JS, Python, SQLite
Hard nos:                      no AWS, no React, no build pipeline, no account system

Notes:
 Runs in my browser. I am the only user, the only device matters.
 Sync between phone and laptop would be nice but is not a hard requirement.
 If sync is needed later, I will add it as a separate step, not bake it
 into the initial design.
```

---

## How the decision log changes AI behavior

Without a decision log, the AI infers your constraints from your question. The clarification gate forces it to be explicit about those inferences, but it still has to guess at things you did not say (and it often guesses wrong, in the direction of popular-stack defaults).

With a decision log, the AI has hard answers for the questions that matter most. The clarification gate has nothing left to elicit for the documented fields, and the AI cannot ask for an enterprise-scale architecture for a single-user tool because the decision log explicitly says "user count: 1." The clarification gate still runs (it covers other things — restating the question, naming the boring choice, rating reversibility), but it is shorter and sharper.

---

## When to update the decision log

Update it whenever a constraint actually changes:
- You decided to add a second user (or to make the tool truly shareable).
- Your budget changed.
- A previously "hard no" became acceptable (or a previously fine choice became a hard no).
- You hit a wall with the current stack and want to revisit.

Do NOT update it just because the AI suggested something fancier. The whole point of the log is to resist that suggestion.
