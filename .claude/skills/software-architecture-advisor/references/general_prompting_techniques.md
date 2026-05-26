# Prompting Techniques for Frontier LLMs: A Hobbyist's Reference Guide (May 2026)

A practical, evidence-graded reference for working with Claude (Sonnet/Opus 4.x) as your daily driver, with regular detours through GPT-4/5 and Gemini 2.x. Each pattern is graded for stability, scoped to where it earns its space, and noted only when models behave materially differently.

---

## 1. How to read this guide

- **Stability tags.** `[Established]` patterns have replicated across at least two independent research labs, or have a lab origin plus six-plus months of consistent practitioner adoption, or have six months of consensus across multiple named practitioners with no significant contradiction. `[Emerging]` means single-lab origin or thin evidence. `[Vendor-specific]` is documented for one vendor only.
- **Claude is the reference point**, not the subject. Cross-model deltas appear only where a documented difference exists; otherwise the subsection is omitted.
- **Worked examples show prompts only.** Expected behavior is described in general terms — no fabricated model outputs.
- **Time bound.** Primary sources are restricted to roughly November 2024 onward, with older sources allowed only when load-bearing (e.g., "Lost in the Middle," 2023).

---

## 2. Canonical patterns

### Role assignment / persona prompting  [Established, with sharp caveats]

Definition: Prefacing a task with an identity ("You are a senior security engineer reviewing this PR…") to bias style, vocabulary, and decision thresholds.

When it helps:
- Style, register, and audience targeting (tone, vocabulary, voice).
- Domain-relevant *expert* personas on knowledge-heavy tasks where the persona description encodes real decision criteria ("acting as a hospital pharmacist checking interactions, flag any contraindications…").
- Keeping a chat model in character over long sessions (especially when paired with prefill on Claude models that still support it).

When it hurts:
- Generic "you are a helpful expert" framings on objective tasks — multiple recent benchmarks find these do not improve and sometimes mildly harm accuracy.
- Adding *irrelevant* persona attributes (random names, demographics, colors). Araujo et al. 2025 ("Principled Personas," arXiv:2508.19764, EMNLP 2025) find "models are highly sensitive to irrelevant persona details, with performance drops of almost 30 percentage points" on objective benchmarks.
- Reasoning models (o-series, Claude with extended thinking, Gemini with thinking) — vendor docs and PromptHub's o1 evaluation note that heavy persona scaffolding adds noise without lift.

Cross-model deltas:
- Claude (Sonnet/Opus 4.x): System prompt is the canonical home for role. Anthropic's prompt engineering guide explicitly recommends role in the system slot plus XML-tagged context in the user turn.
- GPT-4/5: Use the *developer* message for role; the GPT-5.5 prompting guide warns that elaborate persona scaffolding "can add noise, narrow the model's search space, or lead to overly mechanical answers."
- Gemini 2.x: Persona goes in the System Instruction; Google AI docs recommend placing role constraints at the very beginning. Gemini 2.5 Pro is notably verbose by default — a role like "concise senior reviewer" combined with an explicit "Be concise" instruction is more effective than persona alone (16x Eval's controlled comparison).

Worked example:
Weak: "You are an expert. Summarize this contract."
Strong: "You are a commercial-contracts paralegal preparing a one-page risk memo for a non-lawyer founder. Flag indemnity, IP assignment, termination, and auto-renewal. Use plain English; cite clause numbers."
Expected delta: Weak prompts tend to produce generic executive-summary prose with no risk-prioritization signal; strong prompts produce sectioned, clause-anchored output that matches the named deliverable.

Common variants: expert-persona, audience-persona ("explain to a smart 14-year-old"), adversarial-persona ("you are a skeptical reviewer"), multi-persona/debate.

---

### Few-shot prompting  [Established]

Definition: Including 1–N input/output exemplars in the prompt so the model infers the target format and decision boundary from pattern, not description.

When it helps:
- Format control where a schema is awkward to specify in prose (irregular CSV-like outputs, custom DSLs, structured annotations).
- Classification with non-obvious label boundaries.
- Tone/style transfer where rules are hard to verbalize.
- Edge-case calibration — one example of how to handle a tricky case is worth a paragraph of instructions.

When it hurts:
- Reasoning models. OpenAI's function-calling guide notes explicitly: "Adding examples may hurt performance for reasoning models."
- Overfitting to the surface form of examples — Gemini docs warn "the model may start to overfit the response to the examples" if too many are provided.
- Long inputs where examples blow the context budget for actual task content.

Cross-model deltas:
- Claude: Anthropic recommends wrapping examples in `<example>`/`<examples>` XML tags. Their prompt engineering guide consistently shows this pattern, and Anthropic engineer Zack Witten's 2024 AI Engineer workshop confirmed Claude's training includes heavy XML usage.
- GPT-4/5: Plain markdown or fenced examples are fine. For GPT-5/o-series, consider dropping few-shot in favor of a single rubric.
- Gemini 2.x: Google's "Prompt design strategies" emphasizes "consistent format across all examples, especially paying attention to XML tags, white spaces, newlines, and example splitters."

Worked example:
Weak: "Classify these tickets as Bug, Feature, or Question."
Strong: "Classify each ticket. Examples:\n`<example><ticket>App crashes on iOS 17 launch</ticket><label>Bug</label></example>`\n`<example><ticket>Can we get dark mode?</ticket><label>Feature</label></example>`\n`<example><ticket>How do I export to CSV?</ticket><label>Question</label></example>`\nNow classify:\n`<ticket>{input}</ticket>`"
Expected delta: Weak prompts tend to drift into prose explanations and inconsistent label casing; strong prompts produce single-token labels matching the exemplar shape.

Common variants: k-shot (1, 3, 5), many-shot (>50-shot once context allows), chain-of-thought few-shot (examples include reasoning traces), dynamic few-shot (retrieve examples by similarity at runtime).

---

### Zero-shot Chain-of-Thought  [Established, scope-narrowed]

Definition: Eliciting intermediate reasoning steps from a non-reasoning model by appending or framing an instruction such as "Let's think step by step" or "Show your work before answering."

When it helps:
- Math, arithmetic word problems, and symbolic reasoning. Sprague et al. 2024 ("To CoT or not to CoT?", arXiv:2409.12183) "conducted a quantitative meta-analysis covering over 100 papers using CoT and ran our own evaluations of 20 datasets across 14 models" and conclude that CoT gives "strong performance benefits primarily on tasks involving math or logic, with much smaller gains on other types of tasks."
- Tasks where the answer requires planning before commitment (multi-constraint scheduling, ordering proofs, deriving regex).
- Non-reasoning chat models (Claude with thinking disabled, GPT-4.1, Gemini 2.5 Flash without thinking budget).

When it hurts:
- **Reasoning models.** OpenAI's GPT-5 prompting guide and the o-series guidance recommend dropping "think step by step" — internal CoT is already trained in, and explicit CoT instructions can either be wasted tokens or actively degrade performance (PromptHub's o1-mini evaluation found "many prompt engineering methods actually result in worse performance" for o1-mini, with CoT specifically degrading code-summarization scores).
- Tasks where instinct beats deliberation (the "Mind Your Step (by Step)" paper, arXiv:2410.21333, documents cases where forcing CoT reduces accuracy on tasks where humans also do worse when made to deliberate).
- Latency-sensitive paths where the marginal accuracy lift doesn't justify the token cost.

Cross-model deltas:
- Claude (Sonnet/Opus 4.x): On non-extended-thinking calls, "think step by step before answering" still helps for math. With **adaptive thinking** enabled on Opus 4.6+/Sonnet 4.6+, do not also ask for CoT — Anthropic's adaptive-thinking docs note Claude "calibrates its thinking based on… the effort parameter and query complexity."
- GPT-4/5: Add CoT for GPT-4.1 and earlier non-reasoning models. For GPT-5 family with `reasoning_effort` set, omit CoT instructions; the model is reasoning internally.
- Gemini 2.x: Useful on 2.5 Flash without thinking; on 2.5 Pro with thinking enabled, redundant.

Worked example:
Weak: "What's the cheapest way to ship 47 boxes weighing 3kg each from Berlin to Lisbon by next Friday?"
Strong: "What's the cheapest way to ship 47 boxes weighing 3kg each from Berlin to Lisbon by next Friday? Think step by step: list candidate carriers, compute total weight and volumetric weight, check transit times against the deadline, then compare prices. State your final recommendation last."
Expected delta: Weak prompts tend to jump to a single named carrier without showing arithmetic or deadline-feasibility checks; strong prompts produce visible intermediate calculations that are easier to spot-check.

Common variants: "Let's think step by step" (Kojima 2022), "Take a deep breath and work through this" (DeepMind OPRO, narrow to PaLM-2 era — see §4), structured-step CoT (numbered phases), faithful CoT (constrained to symbolic execution).

---

### Structured Chain-of-Thought  [Established]

Definition: Pre-defining the named reasoning steps the model must walk through (e.g., "First state assumptions; second list options; third score each; fourth pick one") rather than open-ended "think step by step."

When it helps:
- Repeatable workflows where consistency across runs matters more than peak creativity (eval rubrics, code review, triage).
- Tasks where you want to inspect specific intermediate signals.
- Multi-criteria decisions where unstructured CoT tends to skip a dimension.

When it hurts:
- Truly exploratory work where the right decomposition isn't known in advance.
- Reasoning models with high effort — the internal trace already does this; an external structure can fight the trained pattern.

Cross-model deltas:
- Claude: XML scaffolding for the steps is idiomatic (`<assumptions>`, `<options>`, `<scoring>`, `<decision>`). Anthropic's XML-tag documentation pitches it as the single most reliable structure for complex prompts.
- GPT-4/5: Markdown headers or numbered sections work equally well; GPT-5's prompting guide uses `<context_gathering>`, `<persistence>`, `<dig_deeper_nudge>` blocks in cookbook examples.
- Gemini 2.x: Google's docs accept either XML or markdown but recommend picking one and being consistent.

Worked example:
Weak: "Review this PR carefully."
Strong: "Review this PR using these steps, each in its own section:\n1. `<summary>`: what does this change do, in one sentence?\n2. `<correctness>`: are there bugs, off-by-ones, race conditions?\n3. `<security>`: any injection, auth, or PII risks?\n4. `<style>`: deviations from the repo's conventions.\n5. `<verdict>`: approve / request-changes / block, with one-line justification."
Expected delta: Weak prompts tend to mix dimensions or omit some (often security); strong prompts produce one analysis per axis with a stable, parseable shape.

Common variants: Plan-then-execute, Chain-of-Verification, self-discover (the model proposes its own step list before executing), domain-specific rubrics (DeCRIM: Decompose-Critique-Refine, Ferraz et al. 2024).

---

### Self-consistency  [Established, with diminishing returns on frontier models]

Definition: Sampling N independent reasoning paths at non-zero temperature and taking the majority-vote (or aggregated) answer.

When it helps:
- Genuinely hard problems where a single chain has high variance (competition math, multi-hop QA, hard reasoning eval sets).
- Settings where you can afford the N× cost and want a confidence signal (vote share).
- Weaker or older models that still benefit substantially from ensembling.

When it hurts:
- Frontier models broadly. Loo 2025 ("Reevaluating Self-Consistency Scaling in Multi-Agent Systems," arXiv:2511.00751) finds "accuracy gains from increasing the number of sampled reasoning paths are minimal — 0.4% on HotpotQA across 20 samples [Gemini 2.5 Flash-Lite], and 1.6% on MATH-500 [Gemini 2.5 Pro, CoT baseline 98% rising to 99.6% at 15 paths]," with declines in some configurations at high sample counts, "more consistent with noise introduction on problems that were already solved."
- Cost-sensitive paths: token spend is linear in N.
- Open-ended tasks (creative writing, planning) — there's nothing to vote over.

Cross-model deltas:
- Claude with adaptive thinking already explores internally; external sampling provides limited additional lift on tasks Claude can already solve.
- GPT-5 with high `reasoning_effort` similarly subsumes much of the benefit.
- Gemini 2.5 Pro: arXiv:2511.00751 shows the classic plateau, but smaller and earlier in the curve than 2022-era results suggested.

Worked example:
Weak: "Solve this AIME problem."
Strong: (orchestration-level) Send the same prompt N=8 times at temperature=0.7 (or via OpenAI Responses API with `n` parameter), parse the final numeric answer from each, take the mode. Optionally weight by vote share to flag low-confidence cases for human review.
Expected delta: Single-sample runs show high variance on hard reasoning items; majority-vote across samples tends to converge on the correct answer when at least one chain finds it, but provides diminishing returns past ~5 samples on frontier models.

Common variants: Self-consistency CoT (vote on final answer only), Universal Self-Consistency (LLM-judges the candidates), CoT–PoT ensembling (mixing chain-of-thought and program-of-thought samples).

---

### Constraint framing (positive vs. negative instructions)  [Established]

Definition: Telling the model what *to do* rather than what *not to do*; using concrete affirmative descriptions of desired behavior.

When it helps:
- All formatting and style instructions ("respond in three sentences" > "don't be long-winded").
- Verbosity control on chatty models (Gemini 2.5 Pro especially).
- Safety/scope constraints when paired with a positive frame ("answer only questions about cooking; for anything else, respond 'I can only help with cooking questions'").

When it hurts:
- "Don't think about a pink elephant" effects — Anthropic's prompt engineering literature (echoed in the PromptLayer workshop notes from Zack Witten) warns that "telling Claude too forcefully what not to do can sometimes backfire and actually encourage that behavior through a kind of reverse psychology effect."

Cross-model deltas:
- Claude: Anthropic's Opus 4.7 docs are explicit: "Positive examples showing how Claude can communicate with the appropriate level of concision tend to be more effective than negative examples or instructions that tell the model what not to do."
- GPT-4/5: Same direction; GPT-5.5 guide emphasizes "exact output and citation formats" over prohibitions.
- Gemini 2.x: Both Google and 16x Eval found "Be concise" works for Gemini 2.5 Pro coding tasks; "Minimize prose" alone did not.

Worked example:
Weak: "Don't be too technical and don't use jargon and avoid being condescending."
Strong: "Write for a non-technical founder. Use plain English. Define any term a non-engineer wouldn't know in a parenthetical. Average sentence length: under 20 words."
Expected delta: Weak prompts produce hedged outputs that still contain jargon (because "don't" framings prime the forbidden vocabulary); strong prompts hit the named register more reliably.

Common variants: Format anchoring ("respond as a markdown table with columns X, Y, Z"), exemplar-based constraint (show, don't tell), explicit refusal templates.

---

### Structured output (JSON schemas, XML tags, function-call shapes)  [Established]

Definition: Constraining the model to emit a parseable format — either by prompt instruction, by schema-enforced decoding, or by function-calling APIs.

When it helps:
- Any programmatic downstream consumer.
- Reducing post-hoc parsing fragility. OpenAI reports that "gpt-4o-2024-08-06 with Structured Outputs scores a perfect 100%" on their complex-JSON-schema-following eval, "In comparison, gpt-4-0613 scores less than 40%."
- Enforcing tool-call argument shapes.

When it hurts:
- **Reasoning quality on hard tasks.** Tam et al. 2024 ("Let Me Speak Freely?", EMNLP Industry, arXiv:2408.02442) found "a significant decline in LLMs' reasoning abilities under format restrictions… stricter format constraints generally lead to greater performance degradation in reasoning tasks." The .txt team contested methodology in "Say What You Mean," and arXiv:2507.03347 (2025) shows that *thoughtfully structured* schemas with named reasoning fields can outperform free-form CoT — so the safe rule is: let the model reason in a `reasoning` field before emitting `final_answer` fields.
- Tasks where the schema fights the natural answer shape (creative writing, open-ended advice).

Cross-model deltas:
- Claude: XML tag instructions in the prompt remain idiomatic. Claude Opus 4.6+ also supports a formal Structured Outputs feature; Anthropic's docs now recommend it "for production applications that require strict format compliance."
- GPT-4/5: JSON Schema via `response_format` is the canonical path. The OpenAI cookbook recommends always including a reasoning field first when the task is non-trivial.
- Gemini 2.x: `response_schema` parameter. Google AI: "we recommend using Gemini API's structured output feature when specifying a more complex JSON Schema for the response."

Worked example:
Weak: "Extract the company name, ticker, and quarterly revenue from this filing as JSON."
Strong: (Schema-enforced) `response_format = { type: "json_schema", schema: { properties: { reasoning: { type: "string", description: "Notes on which section you pulled each value from" }, company: { type: "string" }, ticker: { type: "string" }, revenue_usd: { type: "number" }, confidence: { enum: ["high","medium","low"] } }, required: ["reasoning","company","ticker","revenue_usd","confidence"] } }`
Expected delta: Weak prompts produce JSON with occasional preamble or markdown fencing that breaks parsers; schema-enforced calls are guaranteed parseable, and the `reasoning` field reduces the format-vs-quality tradeoff documented in Tam et al.

Common variants: prompt-only JSON, JSON mode (best-effort, no schema), Structured Outputs (strict schema-enforced decoding), XML tag wrappers (Claude-idiomatic), Pydantic/Zod bindings (Instructor library, OpenAI SDK).

---

### Self-critique / reflection  [Established]

Definition: After producing a draft, the model (or a separate critic call) reviews the output against criteria, then revises.

When it helps:
- Multi-constraint instruction following (DeCRIM, Ferraz et al. 2024, reports "DeCRIM improves Mistral's performance by 7.3% on RealInstruct and 8.0% on IFEval even with weak feedback").
- Code review and bug-finding, where a second pass catches things the first missed.
- Long-form writing with explicit rubric (factuality, tone, structure).
- Reducing format errors when paired with structured output.

When it hurts:
- When the model's own critique is unreliable. Early self-critique work (Huang et al. 2024, Valmeekam et al. 2023) found high false-positive rates and missed true negatives — the model can confidently "fix" things that weren't broken.
- On simple tasks: pure latency/cost overhead with no quality lift.
- When the critic and generator are the same model with the same blind spots — using a *different* model as critic, or grounding critique in tool output (CRITIC, Gou 2023), is materially stronger.

Cross-model deltas:
- Claude with extended thinking already does internal self-critique within a single turn; external critique loops add the most value when you need *inspectable* intermediate artifacts.
- GPT-5: the prompting guide ships a `<self_reflection>` block template specifically for this pattern.
- Gemini 2.x: no specific scaffolding documented; standard critique prompts work.

Worked example:
Weak: "Write a press release about our funding round, then make it better."
Strong: "Step 1: Write a 200-word press release covering: amount, lead investor, use of funds, founder quote, contact. Step 2: Score your draft 1–5 on each of: news-lede strength, factual specificity, jargon-freeness, quote naturalness. Step 3: Rewrite to bring any score below 4 up to a 4+. Output all three steps."
Expected delta: Weak prompts produce a single revision with vague "improvements"; strong prompts produce inspectable rubric scores plus a targeted rewrite — and you can intercept after step 2 if scores look wrong.

Common variants: Self-Refine (Madaan 2023), Reflexion (Shinn 2023), critic-revise with external tool grounding (CRITIC, Gou 2023), DeCRIM constraint-decomposition critique.

---

### Decomposition / prompt chaining  [Established]

Definition: Splitting a complex task into a sequence (or DAG) of smaller prompts, each focused on one subtask, with outputs of one feeding inputs of the next.

When it helps:
- Tasks with distinct phases (research → outline → draft → edit).
- When you need to inspect, log, or branch on intermediate results.
- When subtasks have different optimal model/temperature/effort settings.
- When the full task exceeds the model's reliable single-turn complexity.

When it hurts:
- Simple tasks where chaining is pure overhead.
- When you don't have evals at each stage — a bad early stage poisons everything downstream.

Cross-model deltas:
- Claude: Anthropic's "Chain complex prompts" guide states: "When working with complex tasks, Claude can sometimes drop the ball if you try to handle everything in a single prompt. Chain of thought (CoT) prompting is great, but what if your task has multiple distinct steps that each require in-depth thought? Enter prompt chaining: breaking down complex tasks into smaller, manageable subtasks." With Opus 4.6+/4.7, adaptive thinking handles much of this internally; explicit chaining is most useful for inspection and parallelization.
- GPT-5: OpenAI's GPT-5 prompting guide is unambiguous — "we observe peak performance when distinct, separable tasks are broken up across multiple agent turns, with one turn for each task." OpenAI's developer blog further notes that integrating GPT-5 via the Responses API "scores 5% better on TAUBench compared to Chat Completions, purely by taking advantage of preserved reasoning" across turns.
- Gemini 2.x: documented less explicitly, but Google's prompt design strategies recommend ordering content with critical instructions first when chaining.

Worked example:
Weak: (single prompt) "Research current EU AI Act compliance requirements for a 50-person SaaS company, then draft an internal policy document, then create a one-page exec summary."
Strong: (three calls) Call 1 — "List the EU AI Act obligations that apply to a 50-person SaaS company. Output as `<obligations>` with `<obligation id>`, `<source-article>`, `<applies-because>` for each." Call 2 — "Given these obligations: {output of Call 1}, draft an internal policy with one section per obligation." Call 3 — "Summarize this policy: {output of Call 2} in 250 words for a non-technical exec."
Expected delta: Single-prompt runs tend to collapse the deliverables into a mid-quality blob; chained runs produce inspectable intermediate artifacts where you can fix a hallucinated obligation in Call 1 without re-running Calls 2 and 3.

Common variants: Sequential chains, parallel chains (independent subtasks fan out, then aggregate), conditional chains (router decides next call), MapReduce over documents, plan-and-execute agents.

---

### Retrieval-augmented prompts (context ordering, "lost in the middle")  [Established]

Definition: Injecting retrieved passages or documents into the prompt; specifically the *ordering, framing, and demarcation* of those passages.

When it helps:
- Any question requiring information beyond the model's training data.
- Reducing hallucination when grounded in inspectable sources.
- Long-document analysis when paired with citation grounding.

When it hurts:
- When retrieval quality is bad (irrelevant or contradictory passages can hurt more than no retrieval).
- When you stuff context without ordering — Liu et al. 2024 ("Lost in the Middle," TACL) documents that "performance is often highest when relevant information occurs at the beginning or end of the input context, and significantly degrades when models must access relevant information in the middle of long contexts." Google's own follow-up ("Retrieval Quality at Context Limit," arXiv:2511.05850) shows Gemini 2.5 Flash specifically beats this curve on simple factoid needle-in-haystack across position, but multi-fact synthesis still degrades with middle placement.

Cross-model deltas:
- Claude: Anthropic recommends wrapping each document in `<document>` tags with `<document_content>` and `<source>` subtags, and explicitly says: "For long document tasks, ask Claude to quote relevant parts of the documents first before carrying out its task." Put documents *before* the task instruction in the prompt.
- GPT-4/5: Plain markdown headers with source labels are fine; the OpenAI cookbook's RAG recipes generally place documents before instructions.
- Gemini 2.x: Google's docs are explicit — "When providing large amounts of context (e.g., documents, code), supply all the context first."

Worked example:
Weak: "Answer this question about our refund policy: {long question}. Here are some docs: {five concatenated policy docs}"
Strong: "`<documents>`\n`<document id='1'><source>refunds-2024.md</source><content>{doc1}</content></document>`\n`<document id='2'>…</document>`\n…\n`</documents>`\nUsing only these documents, answer the question below. First quote the exact passages you'll rely on (with document id and line). Then answer. If the documents don't contain the answer, say so.\nQuestion: {question}"
Expected delta: Weak prompts tend to confabulate when the answer isn't in the docs and lose key facts that landed mid-context; strong prompts produce traceable quote-then-answer outputs and explicit refusals when the docs don't support an answer.

Common variants: Quote-then-answer (Anthropic-recommended), reranking before injection, hierarchical RAG (summaries → drill-down), citation-grounded answering (Claude Citations feature, Gemini grounded responses).

---

### Tool-use scaffolding  [Established]

Definition: How tools are *described* to the model — names, parameter docs, when-to-use guidance, examples — distinct from how they're invoked.

When it helps:
- Any agent that selects from >1 tool.
- Reducing wrong-tool selection and malformed arguments.
- Reducing "I don't have access to that" false negatives.

When it hurts:
- Over-stuffed tool catalogs (token cost; selection ambiguity).
- Vague descriptions that force the model to guess at semantics.

Cross-model deltas:
- Claude: Anthropic's "Define tools" doc is explicit: "Provide extremely detailed descriptions. This is by far the most important factor in tool performance… What the tool does; When it should be used (and when it shouldn't); What each parameter means…Aim for at least 3-4 sentences per tool description, more if the tool is complex." Anthropic's engineering blog ("Writing tools for agents") reports that "Claude Sonnet 3.5 achieved state-of-the-art performance on the SWE-bench Verified evaluation after we made precise refinements to tool descriptions." Anthropic also recommends consolidating related operations: "Rather than creating a separate tool for every action (`create_pr`, `review_pr`, `merge_pr`), group them into a single tool with an `action` parameter."
- GPT-4/5: OpenAI's function-calling guide: "Write clear and detailed function names, parameter descriptions, and instructions… Use the system prompt to describe when (and when not) to use each function… Include examples and edge cases, especially to rectify any recurring failures. (Note: Adding examples may hurt performance for reasoning models.)"
- Gemini 2.x: Google AI docs: "Be extremely clear and specific in your descriptions. The model relies on these to choose the correct function and provide appropriate arguments." Google also notes function descriptions count against input token budgets and recommends splitting large tool surfaces into focused subsets when descriptions push you over limits.

Worked example:
Weak: `{ "name": "search", "description": "search the web", "parameters": {...} }`
Strong: `{ "name": "web_search", "description": "Performs a Google-style web search and returns the top 10 results with title, URL, and snippet. Use this when: the user asks about events after your training cutoff; the user asks for current prices, scores, weather, or news; the user asks 'what is the latest…'. Do NOT use this for: math, code generation, or any question answerable from general knowledge. Parameters: query (string) — natural language search query, 3–10 words optimal; recency_days (int, optional) — filter to results from the last N days.", "parameters": {...} }`
Expected delta: Weak descriptions yield over-eager tool calls on questions the model could answer directly, plus malformed queries; strong descriptions produce more selective, better-formed calls.

Common variants: Anthropic-style consolidated tools with action params, OpenAI strict-mode function calling, Gemini function declarations, MCP (Model Context Protocol) server descriptions, tool-search/dynamic tool loading for large catalogs.

---

### Prefill (putting words in the assistant's mouth)  [Vendor-specific to Claude; deprecated on latest Claude models]

Definition: Including a partial assistant-role message at the end of the input so the model continues from that prefix.

When it helps (on supported models):
- Forcing immediate JSON or XML output by prefilling `{` or `<output>`.
- Skipping preambles ("Sure, I'd be happy to help…").
- Maintaining role consistency in long role-play sessions (`[CHARACTER_NAME]:` prefix).
- Constraining single-token classification ("The answer is" + `max_tokens=1`).

When it hurts / when it's unavailable:
- **Not supported on Claude Opus 4.6, 4.7, or Sonnet 4.6.** Anthropic's Messages API docs state: "Prefilling is not supported on Claude Mythos Preview, Claude Opus 4.7, Claude Opus 4.6, and Claude Sonnet 4.6. Requests using prefill with these models return a 400 error. Use structured outputs or system prompt instructions instead."
- Not supported when Claude extended thinking is enabled (any model).
- Incompatible with the Anthropic Structured Outputs feature.

Cross-model deltas:
- Claude (Sonnet/Opus 4.x): Works on Sonnet 4.5 and older Opus models. Migrate to Structured Outputs for the latest models.
- GPT-4/5: No official prefill. Use developer message and `response_format` schema.
- Gemini 2.x: No official assistant-prefill mechanism. Use system instructions and `response_schema`.

Worked example:
Weak: "Output a JSON object with name and age."
Strong (older Claude only): `messages=[{role:"user", content:"Output a JSON object with name and age fields for John, 30."}, {role:"assistant", content:"{"}]`
Expected delta: Weak prompts on older Claude models often produce "Here is the JSON:" preamble; prefilled `{` guarantees the response continues as JSON. On Opus 4.6+, use Structured Outputs instead.

Common variants: format-prefill (`{`, `<answer>`), role-prefill (`[NARRATOR]:`), single-token classification with `max_tokens=1`, partial-sentence steering.

---

### Extended-thinking / reasoning effort control  [Established]

Definition: API-level parameters that control how much hidden reasoning the model performs before producing the visible answer.

When it helps:
- Complex math, multi-step planning, hard code refactors.
- Tasks where you want accuracy over latency.
- Workflows where you can pay extra tokens for fewer downstream errors.

When it hurts:
- Simple queries (lookups, formatting, chat). Latency and cost penalty without lift.
- Cases where you need bounded latency.

Cross-model deltas (this pattern is fundamentally vendor-shaped, so the delta subsection IS the substance):
- Claude (Sonnet/Opus 4.x): Two modes. **Adaptive thinking** (default on Opus 4.6+, Sonnet 4.6, Opus 4.7) — set `thinking: {type: "adaptive"}` and the model decides when and how much to think; combine with the `effort` parameter (`low | medium | high | max`). Sonnet 4.6 defaults to high effort — Anthropic's effort docs caution: "Explicitly set effort when using Sonnet 4.6 to avoid unexpected latency." Older models (Sonnet 4.5, Opus 4.5) use **manual extended thinking** with `thinking: {type: "enabled", budget_tokens: N}` where N ≥ 1024. On Opus 4.7, manual thinking is no longer accepted. Thinking is incompatible with temperature, top_p, top_k modifications, and with prefill.
- GPT-4/5: `reasoning_effort` parameter (`minimal | low | medium | high | xhigh` on GPT-5.1-codex-max; `none` supported on GPT-5.1 and later for skipping reasoning). GPT-5.5 defaults to medium. GPT-5 adds a separate `verbosity` parameter (low/medium/high) controlling answer length independently from reasoning depth.
- Gemini 2.x: Thinking is controlled per model — Gemini 2.5 Pro thinks by default; Gemini 2.5 Flash exposes thinking budget. Less granular than Claude/OpenAI as of May 2026.

Worked example:
Weak: (no thinking) "Refactor this 200-line module to use dependency injection."
Strong: Claude: `thinking: {type: "adaptive"}, effort: "high", max_tokens: 16000`. OpenAI: `reasoning: {effort: "high"}, model: "gpt-5.5"`. For simpler tasks, drop to `effort: "low"` or omit thinking.
Expected delta: Thinking-disabled or low-effort runs on hard refactors tend to produce plausible-looking but subtly wrong code (variable scoping, init order); high-effort thinking produces fewer such errors at the cost of higher latency and tokens.

Common variants: fixed `budget_tokens` cap, adaptive thinking, interleaved thinking (reasoning between tool calls — beta on older Claude 4 models, automatic on Opus/Sonnet 4.6+), verbosity decoupled from effort (GPT-5+).

---

### ReAct (Reason + Act, interleaved)  [Established]

Definition: An agent loop that alternates explicit reasoning ("Thought:"), action ("Action: search[…]"), and observation ("Observation: …") steps, with the model committing to a final answer only when ready.

When it helps:
- Multi-step research and tool-use tasks where each step depends on observed results.
- Settings where you want a human-readable trace of agent decisions.
- Tasks where pure CoT hallucinates because the answer requires external lookup.

When it hurts:
- Single-tool, single-step tasks (overhead).
- Modern reasoning models with native tool use and interleaved thinking — much of ReAct's structural benefit is now subsumed into the model. Anthropic's interleaved thinking (Claude 4 family) and OpenAI's Responses API native loop handle this internally.
- When tool result formatting is poor — large JSON blobs in observations fragment attention.

Cross-model deltas:
- Claude: Interleaved thinking on Opus/Sonnet 4.6+ effectively automates ReAct's loop. Anthropic's docs note Claude is trained to "carefully reflect on tool results' quality and determine optimal next steps before proceeding."
- GPT-4/5: Use the Responses API rather than manually orchestrating Thought/Action/Observation strings. OpenAI reports their internal eval showing GPT-5 via Responses "scores 5% better on TAUBench compared to Chat Completions, purely by taking advantage of preserved reasoning."
- Gemini 2.x: Function calling supports the loop but doesn't have a native interleaved-reasoning analog as polished as Claude's as of May 2026.

Worked example:
Weak: "Use search to answer: who won the 2026 Australian Open, and what's their hometown's population?"
Strong: (As tools-enabled API call) Provide `web_search` and `wikipedia_lookup` tools, ask the question directly, and let the model's native agent loop handle planning. For older/weaker models lacking native loops, scaffold with explicit "Thought / Action / Observation" prompt format and a stop sequence on "Observation:" to inject tool results.
Expected delta: Naive single-prompt runs without tool access confabulate winner and population; ReAct-scaffolded or native-loop runs produce traceable lookups with verifiable intermediate steps.

Common variants: Classic ReAct (Yao 2022), Plan-and-Execute (plan upfront, execute steps), Reflexion (ReAct + self-critique), native-loop agents (Anthropic Tool Use, OpenAI Responses, Gemini Function Calling).

---

### Tree-of-Thoughts  [Emerging — narrow utility on frontier models]

Definition: Branching exploration over candidate intermediate "thoughts" with explicit evaluation and backtracking, generalizing linear CoT into a search tree.

When it helps:
- Puzzles with clear evaluation criteria (Game of 24, crosswords, constraint satisfaction).
- Cases where multiple distinct solution paths exist and the right one is non-obvious.
- Settings where you have a high-quality discriminator (≥90% accuracy per Chen et al. 2024) to score branches.

When it hurts:
- General reasoning on frontier models. Sun et al. 2024, "Understanding When Tree of Thoughts Succeeds" (arXiv:2410.17820) finds ToT can "adversely affect the inherent reasoning abilities of weaker LLMs" and that the gains documented in the original Yao et al. 2023 paper (74% on Game of 24 vs. 4% for CoT-GPT-4) don't generalize cleanly to modern reasoning-trained models that already explore internally.
- Cost: ToT typically uses 5–10× the tokens of CoT for marginal or negative gains on most practical tasks.
- Tasks without a reliable scoring function.

Worked example:
Weak: "Solve Game of 24 with these numbers: 3, 3, 8, 8."
Strong (ToT): "For the inputs (3,3,8,8), at each step propose three candidate next operations, score each 1–10 on whether it can lead to 24, expand the top two, and continue until you reach 24 or exhaust the tree. Show the tree."
Expected delta: On classical puzzles ToT outperforms linear CoT for non-reasoning models; on Claude-with-thinking or GPT-5 with high effort, the native exploration tends to match or beat handcrafted ToT scaffolding at lower cost.

Common variants: BFS-ToT, DFS-ToT, Graph-of-Thoughts (arbitrary connections, Besta et al. 2024), Adaptive Graph-of-Thoughts (Radha et al. 2025), ToTRL (RL-trained tree exploration).

---

## 3. Disagreements between labs (where they actually exist)

These are the disagreements I can document with primary sources from each side; others (e.g., persona-prompting wars) are characterized as nuance rather than disagreement because the labs broadly agree on the direction even when individual papers find different magnitudes.

**3.1 Does CoT prompting help reasoning models?**
- *Against*: PromptHub's controlled comparison on o1-mini found "many prompt engineering methods actually result in worse performance" with CoT prompts specifically degrading code-summarization scores. OpenAI's GPT-5 cookbook recommends not adding "think step by step" — the reasoning is trained-in. Anthropic's adaptive-thinking docs make the same point implicitly: Claude calibrates thinking automatically and explicit CoT may fight that calibration.
- *For (narrow cases)*: Sprague et al. 2024 shows that even on top of reasoning training, explicit CoT still helps on math/symbolic tasks involving equations — but on MMLU, "directly generating the answer without CoT leads to almost identical accuracy as CoT unless the question or model's response contains an equals sign."
- *Resolution*: For non-reasoning chat models, CoT helps on math/symbolic and is neutral elsewhere. For reasoning models with thinking enabled, CoT is redundant or mildly harmful.

**3.2 Does structured output degrade reasoning?**
- *Pro-degradation*: Tam et al. 2024 reports "stricter format constraints generally lead to greater performance degradation in reasoning tasks."
- *Pro-no-degradation*: The .txt team's response "Say What You Mean" argues the original paper's prompts were unfair to structured generation; OpenAI claims gpt-4o-2024-08-06 with Structured Outputs hits "a perfect 100%" on schema-following without claiming degraded task quality when the schema is reasonably designed.
- *Resolution*: The disagreement is real but narrows once you include a `reasoning` field before the constrained answer fields. arXiv:2507.03347 (2025) confirms that thoughtfully structured schemas with named reasoning steps can outperform free-form output.

**3.3 Is self-consistency still worth its cost on frontier models?**
- *Against*: Loo 2025 (arXiv:2511.00751) shows gains of "0.4% on HotpotQA across 20 samples" for Gemini 2.5 Flash-Lite and "1.6% on MATH-500" for Gemini 2.5 Pro at 15 paths (98% CoT baseline → 99.6%), with declines at very high sample counts — calling self-consistency "an expensive habit mismatched to current model capabilities."
- *For*: Reasoning-model leaderboards (e.g., AIME with o4-mini at high sample counts) still show meaningful gains from majority voting on the hardest items.
- *Resolution*: Self-consistency is increasingly a tool of last resort — useful on truly hard problems where a single sample has high variance, mostly subsumed by trained-in reasoning on everyday tasks.

No documented head-to-head lab disagreement exists for retrieval-augmented prompting, prefill (only one vendor implements it), or ReAct.

---

## 4. Debunked or overstated

**Generic "you are an expert" personas don't improve objective task performance.** Zheng et al. 2023/2024 ("When 'A Helpful Assistant' Is Not Really Helpful," arXiv:2311.10054) systematically shows persona prompts in system messages do not improve performance over no-persona baselines on objective tasks. Araujo et al. 2025 ("Principled Personas," arXiv:2508.19764) adds that "models are highly sensitive to irrelevant persona details, with performance drops of almost 30 percentage points." Keep persona prompting for style/audience targeting, not as a reasoning booster.

**Emotional appeals and tipping/threats: weak evidence on frontier models.** The original EmotionPrompt paper (Li et al., arXiv:2307.11760) showed +8% on Instruction Induction and +115% on BIG-Bench Hard *on 2023-era models* (ChatGPT, Vicuna-13b, Bloom, Flan-T5-large). I cannot find a peer-reviewed replication on Claude 4.x, GPT-5, or Gemini 2.x that shows comparable gains. Treat "this is very important to my career" and "I'll tip you $200" as folklore until replicated on current models.

**"Take a deep breath" was a PaLM-2-specific artifact.** The DeepMind OPRO paper (arXiv:2309.16797 / 2309.03409) found this phrase optimized PaLM-2's GSM8K performance — but it was discovered by *automated prompt optimization specifically against PaLM-2*. There is no published evidence that the exact phrase generalizes to Claude, GPT, or Gemini at their current versions. Promptbreeder and OPRO's broader message — that automatic prompt search can find non-obvious task-specific phrases — is robust; the specific magic phrase is not.

**Excessive "do not" / negative instruction stacking.** Anthropic's own Opus 4.7 docs and the leaked PromptLayer workshop notes converge: positive framing outperforms negative framing. Lists of "do not X, do not Y, never Z" tend to anchor the model's attention on the forbidden behaviors.

**Transferability claims across model families.** A 2024-vintage prompt tuned for GPT-4 will not transfer cleanly to Claude 4.7 or Gemini 2.5. Anthropic's release notes for Opus 4.7 explicitly warn that a "code-review harness was tuned for an earlier model, you may initially see lower recall… likely a harness effect, not a capability regression." Re-tune per model family, especially when switching between reasoning and non-reasoning modes.

**Status of Tree-of-Thoughts.** Demoted from `[Established]` to `[Emerging]` for general use because the most recent evidence (Sun et al. 2024) shows narrow utility on frontier models — most of its benefit is captured by trained-in reasoning plus self-consistency on hard puzzles. It remains canonical for the small set of search-shaped puzzle tasks it was designed for.

---

## 5. Coverage and limits

**Sources searched:**
- Vendor documentation: Anthropic (docs.claude.com, platform.claude.com, anthropic.com/engineering), OpenAI (platform.openai.com, developers.openai.com, cookbook.openai.com), Google (ai.google.dev), with model-specific pages for Claude Opus 4.5/4.6/4.7, Sonnet 4.5/4.6, GPT-5/5.1/5.2/5.5, o3/o4-mini, Gemini 2.5 Flash/Pro and Gemini 3.
- arXiv papers from Nov 2024–May 2026 on CoT meta-analysis (Sprague 2024), persona prompting (Araujo 2025, Zheng 2023), self-consistency on frontier models (Loo 2025, arXiv:2511.00751), structured output and reasoning (Tam 2024, arXiv:2507.03347), long context (arXiv:2511.05850, Lost-in-the-Middle TACL 2024), ToT variants (Sun 2024, ToTRL, Adaptive Graph-of-Thoughts), self-critique (DeCRIM 2024, Critique-GRPO 2025).
- Named practitioners: Simon Willison (Claude 4 system prompt analysis, May 2025), PromptHub (reasoning-model prompt sensitivity), 16x Eval (Gemini verbosity), PromptLayer / Zack Witten workshop notes, Anthropic engineering blog ("Writing tools for agents").
- System cards: OpenAI o1 system card (Dec 2024).

**What I tried to find but couldn't:**
- Controlled head-to-head evaluations of *prefill* equivalents on Gemini 2.x — Gemini does not expose an assistant-prefill mechanism, so no direct comparison exists.
- A clean peer-reviewed replication of EmotionPrompt on Claude 4.x, GPT-5, or Gemini 2.5+. The original 2023 results are still cited but not replicated on modern models.
- A primary Anthropic paper (vs. docs) quantifying the lift from XML tags on Claude 4.x specifically. The recommendation is universal across Anthropic surfaces, but I could not find a single controlled ablation paper from Anthropic 2025–2026.
- Direct comparison of Claude `effort` levels vs. OpenAI `reasoning_effort` levels on a shared benchmark. Each vendor publishes only same-family comparisons.
- An update on the "Let Me Speak Freely" vs. ".txt response" dispute that uses Claude 4.x or GPT-5 (most extant work uses GPT-3.5/4 and Llama).

**What would change this guide:**
- A controlled multi-lab benchmark of CoT-vs-no-CoT on reasoning models. PromptHub's existing study is suggestive but limited to o1-mini.
- A replication of EmotionPrompt on May 2026-era frontier models showing comparable lift would re-promote it from "debunked" to "fringe but useful."
- Native prefill or its equivalent landing in OpenAI/Gemini APIs would change the prefill entry from `[Vendor-specific]` to `[Established]`.
- A demonstrated discriminator architecture pushing >90% step-judgment accuracy would revive ToT.
- Any vendor releasing a structured reasoning trace that the user can edit and re-inject would create a new pattern category.

---

*Last updated: May 22, 2026. Tags assume model versions: Claude Opus 4.7 / Sonnet 4.6, GPT-5.5 / GPT-5.2 codex-max, Gemini 2.5 Pro / Gemini 3 Pro.*