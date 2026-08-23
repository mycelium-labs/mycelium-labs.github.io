# Mycelium GTM research

Research pass completed **2026-08-23**. All external sources were retrieved on that
date. This document is the source of truth for the positioning implemented in
`docs/`.

Every claim below is tagged:

- **FACT** — verifiable in the product repository, on a cited page, or from a
  public API at the retrieval date.
- **INFERENCE** — a strategic conclusion drawn from those facts. Reversible.
  These are opinions with reasoning attached, not measured results.

Product source of truth: [`mycelium-labs/mycelium`](https://github.com/mycelium-labs/mycelium),
specifically `README.md` and `sdk/docs/FAILURE_MODE_CATALOG.md`. Nothing on the
website may claim a capability, customer, outcome, or historical baseline that is
not present there.

---

## 1. Ideal customer profile

**INFERENCE.** The buyer is the person accountable when an agent does something
irreversible twice:

- Engineering leads and staff/platform engineers who own an agent that is moving
  from read-only analysis into consequential tools.
- Technical founders shipping an agent product where a tool call spends money,
  contacts a customer, or changes infrastructure.

Qualifying signal: the team has at least one Python tool whose second execution
costs real money, real reputation, or real data.

Out of scope, deliberately:

- Teams whose agents only read, summarise, or draft. There is nothing
  irreversible to protect and the install is pure overhead.
- Teams looking for prompt quality, answer accuracy, or hallucination scoring.
  **FACT:** the failure catalog explicitly places AF-001 hallucination cascade,
  AF-005 goal misalignment, and AF-009 instruction injection outside the
  deterministic SDK (`sdk/docs/FAILURE_MODE_CATALOG.md`).
- Non-Python stacks. **FACT:** the runtime is a Python 3.10+ library
  (`README.md`).

**FACT — supported surfaces.** LangGraph, CrewAI, or a plain Python loop;
framework-agnostic; adopted through YAML plus `mycelium run`, or through
decorators (`README.md`).

## 2. Buying trigger

**INFERENCE.** Nobody installs a control boundary because it is architecturally
correct. They install it the week after an ambiguous execution. The concrete
triggers, in the order they tend to occur:

1. A framework redispatched a long-running tool and the provider was called
   twice.
2. A worker crashed between the provider call and the recorded result, and no
   one can say whether the effect landed.
3. The model minted a new tool-call id for the same tool and arguments, so
   call-id deduplication did not fire.
4. A provider returned a timeout or an ambiguous error and the retry decision
   became a coin flip.
5. Someone asked, in review, "what stops this from charging twice?" and the
   honest answer was "the model usually doesn't."

**FACT — the trigger is documented by the frameworks themselves.** LangGraph's
graph API documentation, section *Re-execution and idempotency*, states that
checkpoints are saved at super-step boundaries rather than mid-node, that a node
"runs again from the start of its function" when execution resumes, that "code
and side effects before the pause run again," and instructs developers to
"design node logic so re-execution does not corrupt state" using "idempotency
keys, upserts, or read-before-write checks."
([LangGraph graph API docs, retrieved 2026-08-23](https://langchain-ai.github.io/langgraph/how-tos/state-reducers/))

**FACT — the product repository tracks a concrete instance.** LangGraph Cloud
redispatches long tools around ~180s; `README.md` cites
[langgraph#7417](https://github.com/langchain-ai/langgraph/issues/7417) as the
window the ledger guards.

**INFERENCE.** That framework instruction — "make your side effects idempotent"
— is the entire market. It is correct advice, and it is homework assigned to
every application developer individually. Mycelium is the general answer to that
homework, sitting outside the agent framework so it survives the framework's own
retry semantics.

## 3. Category

**INFERENCE.** Mycelium is a **runtime control boundary for consequential agent
actions**. The defining property: it decides *whether a tool may execute*, at
execution time, before the side effect. Every adjacent category acts either
earlier (validation of intent) or later (record of what happened).

This is a narrow category on purpose. Naming it "reliability layer" or "agent
guardrails" puts Mycelium in a crowded comparison it does not win and does not
need to enter.

**Explicitly complementary, not competitive:**

| Adjacent category | Also needed for | Mycelium does not replace it |
|---|---|---|
| Observability and evals | Knowing what happened, scoring answer quality | Mycelium ships no traces, dashboards, or judges |
| Workflow durability | Resuming long-running business processes | Mycelium does not schedule, orchestrate, or host workflows |
| Prompt and tool guardrails | Blocking malicious or malformed intent | Mycelium does not classify content or score prompts |
| Agent frameworks | Building the loop itself | **FACT:** `README.md` — "Not an approvals inbox, hosted observability, on-chain audit trail, or agent framework" |

## 4. Alternatives and landscape

All statements in this section are **FACT** at the 2026-08-23 retrieval date,
quoted or paraphrased from the cited page. The interpretation that follows each
is inference.

### Temporal — durable execution

> "Temporal delivers crash-proof execution by guaranteeing that applications
> resume exactly where they left off after crashes, network failures, or
> infrastructure outages."

([temporal.io](https://temporal.io/) · [docs.temporal.io](https://docs.temporal.io/),
retrieved 2026-08-23)

**INFERENCE.** Temporal guarantees the *workflow* resumes and retries
automatically. Whether a given non-idempotent provider call is safe to re-attempt
is still the application's problem — durable execution makes retries reliable and
frequent, which raises rather than lowers the value of an at-most-once boundary
at the tool. Different altitude: Temporal owns the process, Mycelium owns the one
call that must not repeat. A team can run both.

### LangSmith — observability, evaluation, prompt engineering, deployment

> "LangSmith's testing tools help you measure agent quality, iterate on prompts,
> and debug live in an interactive environment. Evaluation is the core of
> testing: it scores your agent's outputs against datasets and criteria."

([LangSmith evaluation docs](https://docs.langchain.com/langsmith/evaluation) ·
[LangChain observability docs](https://docs.langchain.com/oss/python/langchain/observability),
retrieved 2026-08-23)

**INFERENCE.** LangSmith answers "was the output good, and what happened during
the run." Both questions are answered after execution. A trace of a duplicate
charge is a very good record of a duplicate charge.

### OpenAI Agents SDK — tool guardrails

> "Tool guardrails wrap `FunctionTool` instances and let you validate or block
> calls to those tools before and after execution... Input tool guardrails run
> before the tool executes and can skip the call, replace the output with a
> message, or raise a tripwire."

With documented coverage boundaries:

> "Tool guardrails apply only to function tools created with `function_tool`.
> Handoffs run through the SDK's handoff pipeline... Hosted tools
> (`WebSearchTool`, `FileSearchTool`, `HostedMCPTool`, `CodeInterpreterTool`,
> `ImageGenerationTool`) and built-in execution tools (`ComputerTool`,
> `ShellTool`, `ApplyPatchTool`, `LocalShellTool`) also do not use this guardrail
> pipeline."

([OpenAI Agents SDK guardrails](https://openai.github.io/openai-agents-python/guardrails/),
retrieved 2026-08-23)

**INFERENCE.** This is the closest adjacent mechanism and the most honest
comparison to make. Tool guardrails inspect *this* call and decide whether it
should proceed. They are stateless with respect to prior attempts: a guardrail
that approved a charge will approve the identical charge again after a crash,
because the call is still valid. Mycelium's question is different — not "is this
call acceptable" but "did this effect already happen." It is also framework-bound
by design; Mycelium sits below the framework so it covers the same tool
regardless of which loop dispatched it.

### AgentOps — observability and monitoring

> "AgentOps is the developer favorite platform for testing, debugging, and
> deploying AI agents and LLM apps... Observability and monitoring for your AI
> agents and LLM apps."

([AgentOps docs](https://docs.agentops.ai/v1/introduction), retrieved 2026-08-23)

**INFERENCE.** Same altitude as LangSmith for this comparison: session
waterfalls, dashboards, post-hoc analysis.

### OWASP Top 10 for Agentic Applications

**FACT.** The OWASP GenAI Security Project released its Agentic Top 10 on
2025-12-09. Entries include **ASI02 – Tool Misuse** ("Agents bent legitimate
tools into destructive outputs") and **ASI03 – Identity & Privilege Abuse**
("leaked credentials let them operate far beyond their intended scope").
([OWASP GenAI Security Project](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/),
retrieved 2026-08-23)

**INFERENCE.** Useful as third-party validation that the tool boundary is a
recognised control point, and useful for a security-conscious buyer who needs an
external frame. Not useful as a compliance claim — Mycelium is not certified
against anything, and the site must not imply it is. Reference it sparingly, or
not at all on the homepage.

### The real default: doing nothing

**INFERENCE.** The most common alternative is a hand-rolled `if already_sent:
return` check next to one tool, backed by a dictionary or a database column. It
works until the process dies between the provider call and the write, which is
exactly the case that matters. The pitch has to beat "we already handle this,"
not just beat other vendors.

## 5. Differentiation

**INFERENCE.** One sentence, and it should appear on the homepage close to
verbatim:

> Observability tells you what happened. Mycelium controls whether the tool is
> allowed to execute.

Supporting distinctions:

- **Position in time.** Evals run before, traces record after, Mycelium decides
  at the boundary.
- **Unit of protection.** Not the run, not the prompt — the individual
  consequential effect, with a durable identity that survives process death.
- **Failure direction.** **FACT:** `README.md` — if the ledger cannot claim or
  complete, a consequential tool fails closed; dishonest capability declarations
  also fail closed.
- **Verdict, not a warning.** **FACT:** the resolution gates are ALLOW, RETURN,
  POLL, REPAIR, SOFT_BLOCK, HARD_BLOCK. Mutating tools hard-block on ambiguity;
  reads may soft-block (`README.md`, `sdk/docs/FAILURE_MODE_CATALOG.md`).

## 6. Homepage message hierarchy

**INFERENCE** on ordering; the content of each block is constrained by facts.

1. **Category line.** Runtime control boundary for consequential agent actions.
2. **Headline.** The retry contrast: an agent can retry, a payment cannot.
3. **One-sentence explanation.** Open-source Python runtime between the agent
   loop and its consequential tools; a retried, redispatched, or crashed call
   executes at most once.
4. **CTA.** `pip install mycelium-runtime`, then protect one tool. Secondary:
   GitHub and docs.
5. **Compact proof.** MIT, Python 3.10+, PyPI downloads, supported surfaces.
6. **Problem.** Retries are normal. Duplicate irreversible effects are not.
   Name the five triggers from §2.
7. **Mechanism.** CLAIM, then one of ALLOW / RETURN / POLL / REPAIR / SOFT BLOCK
   / HARD BLOCK. The provider is called only on ALLOW.
8. **Exhibit.** The same retry with and without the boundary, as an execution
   trace. This is the memorable artifact on the page.
9. **Differentiation.** The §5 sentence plus the honest landscape table.
10. **Use cases.** Payments, communications, ticket and CRM writes,
    infrastructure and destructive operations.
11. **Proof.** Runnable commands first, then labelled production receipts.
12. **Fit and limits.** Python, integrations, backends, fail-closed boundaries,
    and an explicit list of what Mycelium does not replace.
13. **Final CTA.** Protect one consequential tool.

**INFERENCE — what the wedge is not.** Loop guard, scope guard, completion
contract, secret-in-args, entity guard, destructive confirm, authority window,
use-time currency, and budget are real shipped surfaces and they are the reason
the product has depth. They are not the pitch. Leading with nine guards invites
"which of these do I need," which has no good answer for a first-time visitor.
Lead with at-most-once execution; let the catalog carry credibility below the
fold.

## 7. Objection handling

| Objection | Response | Basis |
|---|---|---|
| "My framework already retries safely." | Retrying safely is the problem, not the solution: the framework guarantees the node runs again. Its own docs assign idempotency to you. | FACT (LangGraph docs) |
| "I already have an idempotency key." | A key deduplicates identical requests at the provider that supports one. It does not cover providers without keys, does not survive a crash between the call and your write, and does not decide what to do when the outcome is unknown. | INFERENCE |
| "We have tracing, we would see it." | You would see it afterwards. The charge already happened. | INFERENCE |
| "Is this another agent framework?" | No. It wraps the tool call your framework already dispatches. | FACT (`README.md`) |
| "What happens when Mycelium itself fails?" | Consequential tools fail closed. Storage that cannot claim or complete blocks the effect rather than allowing it. | FACT (`README.md`) |
| "Prove it." | `mycelium verify --scenario simulation` sweeps crash boundaries and asserts the at-most-one-COMMITTED invariant plus stale-fence rejection on durable backends. `mycelium demo --redis` runs two OS processes against a real Redis ledger. | FACT (`README.md`) |
| "Who else runs this?" | One design-partner outbound-email lane, three weekly windows, 67 ledgered sends, no duplicates — and no ambiguous outcome has occurred yet, so recovery is untested in production. | FACT (site receipts) |
| "What does it cost?" | Nothing. MIT, open source, no hosted product exists. | FACT |

## 8. Conversion strategy

**INFERENCE.** There is no hosted signup and no payment path, so every
conversion goal that implies one is a lie on the page. The previous site carried
a "Free hosted · planned" and "Team · planned" pricing grid with an admission
that price stays experimental until someone pays. That copy asks the visitor to
evaluate a product that does not exist and weakens the thing that does. Remove
it.

The single conversion is: **install the runtime and protect one consequential
tool.**

Path, in order, each step independently useful:

1. `pip install mycelium-runtime`
2. `mycelium demo` — see a duplicate get stopped without touching your code
3. `mycelium init` — scaffold `mycelium.yaml` with one ledgered tool
4. `mycelium run --config mycelium.yaml -- python -m my_app` — wrap the existing
   app with no decorators
5. `mycelium verify --config mycelium.yaml` — exercise synthetic failures against
   the configured backend

Secondary conversions worth measuring: GitHub visit, PyPI visit, sandbox open.

**INFERENCE.** The homepage should be readable as a decision document by someone
who will never install anything, because that person forwards it to the person
who will.

## 9. Proof policy

Binding rules for anything published on the site.

1. **Every number carries its label.** Observed in production, synthetic
   verification, operator asserted, or not verifiable. These four labels already
   exist on `verify.html` and stay.
2. **Never manufacture a historical baseline.** No "reduced duplicates by X%."
   There is no measured before.
3. **State the scale honestly.** The production evidence is one Gmail lane at a
   single design partner: 25 + 23 + 19 = 67 ledgered sends across three weekly
   windows. That is small, and the site says so rather than implying volume.
4. **State what the evidence does not cover.** No genuine UNKNOWN outcome has
   occurred in the live lane, so `GmailReconciler` recovery is unexercised in
   production. This must remain visible; it is currently the most credible
   sentence on the page.
5. **Do not highlight weak vanity metrics.** **FACT:** the GitHub repository has
   14 stars (GitHub API, 2026-08-23). Downloads are a stronger and honest signal;
   stars are not shown on the site.
6. **Downloads are cited, not rounded up.** **FACT:** 25k total PyPI downloads
   for `mycelium-runtime` (pepy.tech badge, 2026-08-23). The site links to the
   source.
7. **Doctor and Verify claims stay bounded.** **FACT:** `README.md` — Doctor
   inspects configuration, Verify runs synthetic scenarios, and neither proves a
   real provider is correct.

## 10. Repository facts snapshot (2026-08-23)

| Fact | Value | Source |
|---|---|---|
| PyPI downloads | 25k total | pepy.tech badge for `mycelium-runtime` |
| GitHub stars | 14 | GitHub API |
| License | MIT | GitHub API, `LICENSE` |
| Python | 3.10+ | product `README.md` |
| Surfaces | LangGraph, CrewAI, plain Python | product `README.md` |
| Ledger backends | file, SQLite, Redis, Postgres | product `README.md` |
| Hosted product | none | product `README.md` |

## 11. Design direction

**INFERENCE.** The visual system is an argument, not decoration. The claim is
"this software keeps an exact, auditable record of what was allowed to execute."
An industrial incident-dossier and transaction-ledger aesthetic makes that claim
before a word is read: paper stock, ink, hairline rules, tabular figures, state
stamps, no ornament.

Removed from the previous design because it argued the opposite: the animated
spore canvas, the immersive fungus illustration, glass navigation, organic
contour SVGs, green gradient backdrops, rounded cards, fake terminal window
chrome, and headline aphorisms with no referent.

The single memorable artifact is the retry exhibit: the same crash and retry
rendered twice, unguarded and guarded, as a timestamped execution trace in plain
HTML and CSS.

## 12. Open questions

Not resolved by this pass. Listed so the next person does not mistake them for
settled.

- Whether "runtime control boundary" survives contact with buyers or whether they
  reach for "idempotency layer" unprompted. Worth testing in the first ten
  conversations.
- Whether the payments framing narrows the funnel too far, given that the
  observed production lane is email.
- Whether a second design partner in a non-email lane is a prerequisite for the
  evidence section to persuade anyone outside the author's network.
- At what point a hosted control plane becomes worth naming publicly. Until it
  exists, it stays off the site.

## Source index

| Source | URL | Retrieved |
|---|---|---|
| LangGraph graph API — re-execution and idempotency | https://langchain-ai.github.io/langgraph/how-tos/state-reducers/ | 2026-08-23 |
| LangGraph Cloud redispatch issue #7417 | https://github.com/langchain-ai/langgraph/issues/7417 | referenced by product `README.md` |
| Temporal | https://temporal.io/ | 2026-08-23 |
| Temporal docs | https://docs.temporal.io/ | 2026-08-23 |
| LangSmith evaluation | https://docs.langchain.com/langsmith/evaluation | 2026-08-23 |
| LangChain observability | https://docs.langchain.com/oss/python/langchain/observability | 2026-08-23 |
| OpenAI Agents SDK guardrails | https://openai.github.io/openai-agents-python/guardrails/ | 2026-08-23 |
| AgentOps introduction | https://docs.agentops.ai/v1/introduction | 2026-08-23 |
| OWASP Top 10 for Agentic Applications | https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/ | 2026-08-23 |
| `mycelium-runtime` on PyPI | https://pypi.org/project/mycelium-runtime/ | 2026-08-23 |
| Download statistics | https://pepy.tech/project/mycelium-runtime | 2026-08-23 |
