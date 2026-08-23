# Mycelium GTM research

Corrective positioning pass completed **2026-08-24**. The product repository,
not the previous website, is the source of truth.

## Category

**Mycelium is the reliability layer between an AI agent and its tools.** It
prevents unsafe runtime actions at the tool boundary: after the model proposes
a call, before the call can cause damage.

This category is broader than idempotency, duplicate prevention, or an action
ledger. Durable execution is one important control inside the system. It is not
the organizing story.

The customer-facing promise:

> Let agents act. Stop unsafe actions before they happen.

The functional explanation:

> Configure the controls that matter, then validate inputs, scope, authority,
> context, budget, and execution state before a consequential tool call can
> touch the real world.

## Ideal customer

Engineering teams putting agents into production with tools that can spend
money, contact customers, alter infrastructure, write business records, access
secrets, operate on files, or delegate to other agents.

The buyer is normally a technical founder, platform lead, staff engineer, or
agent-infrastructure owner accountable for the gap between what a model asks to
do and what production systems should permit.

The strongest buying trigger is not only “we saw a duplicate.” It is the broader
review question:

> What mechanically prevents this agent from taking the wrong action?

That question appears when a prototype receives real credentials, mutating
tools, autonomous loops, handoffs, budgets, or permission to declare work done.

## Product scope

The AF-00N taxonomy is the product story. The SDK is its current distribution.

| Control area | Failure stopped | Shipped surface |
|---|---|---|
| Durable execution | Concurrent, repeated, or ambiguous effects | Transition envelope, ledgers, leases, fences, reconcile, operator release, receipts |
| Tool validation | Bad inputs, outputs, paths, entities, or unregistered tools | `@bounded`, `ToolRegistry`, `ToolRunner` |
| Loop control | Repeated tool patterns under fresh call IDs | `loop_guard`, soft/hard block, operator release |
| Budget control | Runaway steps, tokens, duration, or USD | `budget`, `@budget_guard`, LLM instrumentation |
| Context integrity | Stale state or malformed history | `@protect`, `Session`, `MessageValidator`, `HistoryGuard` |
| Completion control | Partial work presented as complete | `completion`, required/optional host checklist |
| Scope control | Permission widening during a run or handoff | `scope_guard`, frozen allowlist |
| Secret safety | Raw credentials entering args or durable evidence | `secret_args`, `secret://` references, sanitization |
| Destination policy | Writes or exfiltration to the wrong entity | `entity_guard`, host destination allowlist |
| Destructive authority | Delete/refund/cancel against the wrong object | `destructive_confirm`, host-issued exact grants |
| Authority timing | Permission expires before the action is used | `authority_window` |
| Fact currency | Decide-time facts become stale before execution | `use_time_currency` |
| Verification | Safety is configured but not really wired | `mycelium doctor`, `mycelium verify` |

## Honest boundary

Mycelium deterministically controls facts the runtime can prove. It does not
claim deterministic prevention for:

- AF-001 hallucination;
- AF-005 open-ended goal misalignment;
- AF-009 instruction injection.

Those require judgment/evaluation or a future gateway-level mechanism. The
completion contract checks an explicit host checklist; it does not decide
whether an open-ended goal is philosophically correct.

## Competitive frame

Mycelium complements, rather than replaces:

- agent frameworks and durable workflow engines, which orchestrate and resume;
- observability and evaluation products, which explain and score runs;
- provider-native idempotency, which protects a provider operation when the
  provider exposes the right primitive;
- OS/container isolation and application authorization, which enforce broader
  process and identity boundaries.

The differentiation is **preventive runtime enforcement across the whole tool
call**, not another trace, prompt filter, or approvals inbox.

## Message hierarchy

1. **Outcome:** stop unsafe agent actions before they happen.
2. **Mechanism:** a runtime boundary between the agent and every real tool.
3. **Breadth:** validate call, constrain authority, protect context, control the
   run, control execution, record evidence.
4. **Adoption:** Python 3.10+, framework-agnostic, YAML/CLI or decorators.
5. **Proof:** Doctor checks wiring; Verify exercises synthetic failures;
   repository tests prove individual invariants.
6. **Early field evidence:** a small Gmail lane demonstrates one execution
   surface, not the entire product.

## Website correction

The previous GTM pass over-rotated on one technically strong wedge: safe retries
and at-most-once execution. That made the product appear to be an idempotency
library and buried the broader prevention surface.

The corrected website therefore:

- leads with broad tool-action safety;
- presents execution control as one of six safety families;
- shows a call flowing through validation, authority, context/run health, and
  execution state before the tool;
- uses examples beyond payments and email;
- keeps the Gmail evidence explicitly scoped to one live lane;
- avoids implying that hallucination, goal judgment, or injection prevention is
  shipped deterministic functionality.

## Visual direction

The design is a **control spectrum**, not an incident ledger. Cobalt, coral,
lime, amber, violet, and aqua identify different safety families. Curved paths,
orbits, circles, and asymmetrical compositions express one call moving through
many controls. Rectangles are reserved for code and literal runtime output.

This keeps the page technical without making every idea look like a compliance
table. It also avoids the previous fungus metaphor and generic glass/gradient
“AI product” aesthetic.

## Evidence policy

- Never turn zero observed incidents into a reliability percentage.
- Keep production evidence labeled by what it actually exercised.
- State that no genuine live UNKNOWN outcome has exercised recovery yet.
- Treat Doctor as configuration inspection and Verify as synthetic testing;
  neither proves an arbitrary real provider is correct.
- Do not advertise a hosted product or pricing until either exists.
- Keep changing download counts out of the core value proposition.

## Sources

- Product source of truth: https://github.com/mycelium-labs/mycelium
- Failure-mode catalog: https://github.com/mycelium-labs/mycelium/blob/main/sdk/docs/FAILURE_MODE_CATALOG.md
- Failure and threat model: https://github.com/mycelium-labs/mycelium/blob/main/sdk/docs/FAILURE_AND_THREAT_MODEL.md
- LangGraph re-execution guidance: https://langchain-ai.github.io/langgraph/how-tos/state-reducers/
- Temporal durable execution: https://docs.temporal.io/
- LangSmith evaluation: https://docs.langchain.com/langsmith/evaluation
- OpenAI Agents SDK guardrails: https://openai.github.io/openai-agents-python/guardrails/
