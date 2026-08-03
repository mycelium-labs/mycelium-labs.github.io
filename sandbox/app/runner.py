"""Deterministic mini-agent runner - with and without Mycelium (no LLM)."""

from __future__ import annotations

import contextvars
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable

from app.models import Event, Injector, PlanStep, RunResult, ToolOutcome, ToolSpec
from app.yaml_builder import build_yaml, tools_from_plan


@dataclass
class _Runtime:
    outcomes_by_tool: dict[str, ToolOutcome]
    outcomes_by_call: dict[str, ToolOutcome] = field(default_factory=dict)
    current_call_id: str = ""
    executions: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    events: list[Event] = field(default_factory=list)
    slow_release: threading.Event = field(default_factory=threading.Event)
    slow_entered: threading.Event = field(default_factory=threading.Event)

    def outcome_for(self, tool: str) -> ToolOutcome:
        if self.current_call_id and self.current_call_id in self.outcomes_by_call:
            return self.outcomes_by_call[self.current_call_id]
        return self.outcomes_by_tool.get(tool, "success")

    def set_call_outcome(self, call_id: str, outcome: ToolOutcome) -> None:
        self.outcomes_by_call[call_id] = outcome

    def log(self, kind: str, message: str, **detail: Any) -> None:
        self.events.append(Event(kind=kind, message=message, detail=detail))


def _runtime_from_plan(tools: list[ToolSpec], plan: list[PlanStep]) -> _Runtime:
    by_tool = {t.name: t.outcome for t in tools}
    by_call: dict[str, ToolOutcome] = {}
    for step in plan:
        if step.outcome:
            by_call[step.tool_call_id] = step.outcome
        elif step.tool in by_tool:
            by_call[step.tool_call_id] = by_tool[step.tool]
        else:
            by_call[step.tool_call_id] = "success"
    return _Runtime(outcomes_by_tool=by_tool, outcomes_by_call=by_call)


# Tools that record an external effect before a timeout (HARD_BLOCK demos).
_TIMEOUT_AFTER_EFFECT_TOOLS = frozenset(
    {
        "charge",
        "charge_keyed",
        "refund",
        "send_email",
        "ship_order",
        "create_ticket",
        "post_slack",
        "set_status",
        "delete_account",
    }
)


def _tool_kwargs(step: PlanStep, tools: dict[str, ToolSpec]) -> dict[str, Any]:
    spec = tools.get(step.tool) or ToolSpec(name=step.tool)
    if step.tool in {"charge", "refund"}:
        return {"amount": step.amount if step.amount is not None else spec.amount}
    if step.tool == "charge_keyed":
        return {
            "amount": step.amount if step.amount is not None else spec.amount,
            "idempotency_key": (
                step.idempotency_key
                if step.idempotency_key is not None
                else spec.idempotency_key
            ),
        }
    if step.tool == "search_docs":
        return {"query": step.query if step.query is not None else spec.query}
    if step.tool == "send_email":
        return {"to": step.to if step.to is not None else spec.to}
    if step.tool in {"ship_order", "lookup_order"}:
        return {
            "order_id": step.order_id if step.order_id is not None else spec.order_id
        }
    if step.tool == "set_status":
        return {
            "order_id": step.order_id if step.order_id is not None else spec.order_id,
            "status": step.status if step.status is not None else spec.status,
        }
    if step.tool == "create_ticket":
        return {
            "subject": step.subject if step.subject is not None else spec.subject
        }
    if step.tool == "post_slack":
        return {
            "channel": step.channel if step.channel is not None else spec.channel
        }
    if step.tool == "delete_account":
        return {
            "account_id": (
                step.account_id if step.account_id is not None else spec.account_id
            )
        }
    return {}


def _run_effect(
    rt: _Runtime,
    name: str,
    label: str,
    *,
    fail_msg: str,
    timeout_msg: str | None = None,
    result: dict[str, Any],
) -> dict[str, Any]:
    rt.executions[name] += 1
    n = rt.executions[name]
    outcome = rt.outcome_for(name)
    rt.log("exec", label, n=n, outcome=outcome, call=rt.current_call_id)
    if outcome in {"fail_before", "custom_fail"}:
        raise RuntimeError(fail_msg)
    if outcome == "timeout_after_effect":
        raise RuntimeError(timeout_msg or f"{name} timeout after effect")
    if outcome == "slow":
        # Claim/body has started - peer can race against this in-flight call.
        rt.slow_entered.set()
        if not rt.slow_release.wait(timeout=2.5):
            raise TimeoutError(f"{name} peer race timed out waiting for release")
        return {**result, "slow": True}
    return {**result, "outcome": outcome}


def _make_bodies(rt: _Runtime) -> dict[str, Callable[..., Any]]:
    def charge(amount: float) -> dict[str, Any]:
        return _run_effect(
            rt,
            "charge",
            f"charge(amount={amount})",
            fail_msg="charge failed before effect",
            timeout_msg="provider timeout after charge accepted",
            result={"charged": amount},
        )

    def refund(amount: float) -> dict[str, Any]:
        return _run_effect(
            rt,
            "refund",
            f"refund(amount={amount})",
            fail_msg="refund failed before effect",
            timeout_msg="provider timeout after refund accepted",
            result={"refunded": amount},
        )

    def send_email(to: str) -> dict[str, Any]:
        return _run_effect(
            rt,
            "send_email",
            f"send_email(to={to})",
            fail_msg="send_email failed before effect",
            timeout_msg="smtp timeout after accept",
            result={"sent": True, "to": to},
        )

    def ship_order(order_id: str) -> dict[str, Any]:
        return _run_effect(
            rt,
            "ship_order",
            f"ship_order(order_id={order_id})",
            fail_msg="ship failed before warehouse commit",
            timeout_msg="warehouse timeout after label printed",
            result={"shipped": True, "order_id": order_id},
        )

    def create_ticket(subject: str) -> dict[str, Any]:
        return _run_effect(
            rt,
            "create_ticket",
            f"create_ticket(subject={subject!r})",
            fail_msg="ticket create failed before write",
            timeout_msg="helpdesk timeout after ticket created",
            result={"ticket": "T-1001", "subject": subject},
        )

    def post_slack(channel: str) -> dict[str, Any]:
        return _run_effect(
            rt,
            "post_slack",
            f"post_slack(channel={channel})",
            fail_msg="slack post failed before send",
            timeout_msg="slack timeout after message accepted",
            result={"posted": True, "channel": channel},
        )

    def search_docs(query: str) -> dict[str, Any]:
        return _run_effect(
            rt,
            "search_docs",
            f"search_docs(query={query})",
            fail_msg="search failed",
            result={"query": query, "hits": rt.executions["search_docs"]},
        )

    def lookup_order(order_id: str) -> dict[str, Any]:
        return _run_effect(
            rt,
            "lookup_order",
            f"lookup_order(order_id={order_id})",
            fail_msg="lookup failed",
            result={"order_id": order_id, "status": "paid"},
        )

    def set_status(order_id: str, status: str) -> dict[str, Any]:
        return _run_effect(
            rt,
            "set_status",
            f"set_status(order_id={order_id}, status={status!r})",
            fail_msg="status update failed before write",
            timeout_msg="db timeout after status write",
            result={"order_id": order_id, "status": status},
        )

    def charge_keyed(amount: float, idempotency_key: str) -> dict[str, Any]:
        return _run_effect(
            rt,
            "charge_keyed",
            f"charge_keyed(amount={amount}, key={idempotency_key!r})",
            fail_msg="keyed charge failed before effect",
            timeout_msg="provider timeout after keyed charge accepted",
            result={"charged": amount, "idempotency_key": idempotency_key},
        )

    def delete_account(account_id: str) -> dict[str, Any]:
        return _run_effect(
            rt,
            "delete_account",
            f"delete_account(account_id={account_id})",
            fail_msg="delete failed before purge",
            timeout_msg="timeout after account purge started",
            result={"deleted": True, "account_id": account_id},
        )

    return {
        "charge": charge,
        "refund": refund,
        "send_email": send_email,
        "ship_order": ship_order,
        "create_ticket": create_ticket,
        "post_slack": post_slack,
        "search_docs": search_docs,
        "lookup_order": lookup_order,
        "set_status": set_status,
        "charge_keyed": charge_keyed,
        "delete_account": delete_account,
    }


def _normalize_plan_injectors(
    plan: list[PlanStep], fallback: Injector
) -> list[PlanStep]:
    """Use per-step injector; if all are none, apply legacy global fallback."""
    if fallback != "none" and all(s.injector == "none" for s in plan):
        return [s.model_copy(update={"injector": fallback}) for s in plan]
    return plan


def _summarize_gates(gates: list[str]) -> str | None:
    if not gates:
        return None
    seen: list[str] = []
    for g in gates:
        if g not in seen:
            seen.append(g)
    if len(gates) > 1 and len(seen) == 1:
        return f"{seen[0]} (x{len(gates)})"
    return ", ".join(seen)


def _run_plan_without(
    tools: list[ToolSpec],
    plan: list[PlanStep],
    injector: Injector,
) -> RunResult:
    plan = _normalize_plan_injectors(plan, injector)
    by_name = {t.name: t for t in tools}
    rt = _runtime_from_plan(tools, plan)
    bodies = _make_bodies(rt)
    gates: list[str] = []
    err: str | None = None

    def invoke(step: PlanStep) -> Any:
        rt.current_call_id = step.tool_call_id
        return bodies[step.tool](**_tool_kwargs(step, by_name))

    for step in plan:
        inj = step.injector
        try:
            if inj == "none":
                invoke(step)
            elif inj == "redispatch":
                invoke(step)
                invoke(step)
                gates.append("NONE (re-ran)")
                rt.log(
                    "redispatch",
                    f"{step.tool} ran again (unguarded)",
                    call=step.tool_call_id,
                )
            elif inj == "peer_slow":
                rt.set_call_outcome(step.tool_call_id, "slow")
                rt.slow_release = threading.Event()
                rt.slow_entered = threading.Event()

                def owner(s: PlanStep = step) -> None:
                    try:
                        invoke(s)
                    except Exception as exc:  # noqa: BLE001
                        msg = str(exc) or type(exc).__name__
                        rt.log("error", msg, tool=s.tool)

                def peer(s: PlanStep = step) -> None:
                    if not rt.slow_entered.wait(timeout=2.0):
                        rt.log("peer", f"{s.tool}: peer gave up waiting for owner")
                        rt.slow_release.set()
                        return
                    try:
                        # Peer must not also sit on the slow wait (deadlock).
                        rt.set_call_outcome(s.tool_call_id, "success")
                        invoke(s)
                        rt.log("peer", f"{s.tool}: peer also executed (unguarded)")
                    except Exception as exc:  # noqa: BLE001
                        msg = str(exc) or type(exc).__name__
                        rt.log("peer", f"{s.tool} peer error: {msg}")
                    finally:
                        rt.set_call_outcome(s.tool_call_id, "slow")
                        rt.slow_release.set()

                t1 = threading.Thread(target=owner)
                t2 = threading.Thread(target=peer)
                t1.start()
                t2.start()
                t1.join(timeout=4)
                t2.join(timeout=4)
                rt.slow_release.set()
                gates.append("NONE (double execute)")
            elif inj in {"crash_hard_block", "crash_reconcile"}:
                rt.set_call_outcome(step.tool_call_id, "timeout_after_effect")
                try:
                    invoke(step)
                except Exception as exc:  # noqa: BLE001
                    err = str(exc) or type(exc).__name__
                    rt.log("error", err, tool=step.tool)
                try:
                    invoke(step)
                except Exception as exc:  # noqa: BLE001
                    # Body still ran (exec counted) before the timeout raise.
                    err = str(exc) or type(exc).__name__
                    rt.log("error", err, tool=step.tool)
                gates.append("NONE (blind retry)")
                rt.log(
                    "retry",
                    f"{step.tool}: blind retry after crash (unguarded)",
                    call=step.tool_call_id,
                )
        except Exception as exc:  # noqa: BLE001
            err = str(exc) or type(exc).__name__
            rt.log("error", err, tool=step.tool)

    return RunResult(
        mode="without",
        ok=True,
        executions=dict(rt.executions),
        events=rt.events,
        gate=_summarize_gates(gates),
        error=err,
    )


class _SandboxReconciler:
    """Provider lookup stub: if we recorded an external op, it completed."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def reconcile(self, entry: Any) -> Any:
        from mycelium import ReconcileResult

        self.calls.append(getattr(entry, "request_id", ""))
        ref = getattr(entry, "external_operation_ref", None)
        if not ref:
            return ReconcileResult.unknown()
        return ReconcileResult.completed(
            {
                "reconciled": True,
                "tool": getattr(entry, "tool", None),
                "external_operation_ref": ref,
            }
        )


def _wrap_tools(
    rt: _Runtime,
    tools: dict[str, ToolSpec],
    storage: Any,
    *,
    agent_id: str,
    policy_version: str,
    reconciler: Any | None = None,
) -> dict[str, Any]:
    from mycelium import (
        SideEffectClass,
        ToolTransitionBinding,
        ledger_sync,
        record_external_operation,
        side_effect,
    )

    bodies = _make_bodies(rt)
    wrapped: dict[str, Any] = {}

    for name, spec in tools.items():
        binding = ToolTransitionBinding.for_tool(
            agent_id=agent_id,
            policy_version=policy_version,
            side_effect_class=SideEffectClass(spec.side_effect_class),
        )
        body = bodies[name]
        records_timeout = name in _TIMEOUT_AFTER_EFFECT_TOOLS

        def _make_wrapped(
            tool_name: str = name,
            _body: Callable[..., Any] = body,
            _records: bool = records_timeout,
        ) -> Callable[..., Any]:
            def _fn(**kwargs: Any) -> dict[str, Any]:
                # ledger_sync strips tool_call_id before invoking the body.
                # invoke() sets rt.current_call_id - never default to call_1.
                call_id = rt.current_call_id or "call_1"
                if _records and rt.outcome_for(tool_name) == "timeout_after_effect":
                    with side_effect():
                        record_external_operation(
                            f"pi_sandbox_{tool_name}_{call_id}"
                        )
                        return _body(**kwargs)
                return _body(**kwargs)

            _fn.__name__ = tool_name
            _fn.__qualname__ = tool_name
            return _fn

        wrapped[name] = ledger_sync(
            storage=storage,
            transition_binding=binding,
            lease_ttl=0.25,
            lease_renew_interval=0.06,
            poll_timeout=1.5,
            reconciler=reconciler,
        )(_make_wrapped())

    return wrapped


def _run_plan_with(
    tools: list[ToolSpec],
    plan: list[PlanStep],
    injector: Injector,
    *,
    agent_id: str,
    policy_version: str,
) -> RunResult:
    from mycelium import (
        InMemoryLedgerStorage,
        LedgerHardBlockError,
        SideEffectClass,
        ToolTransitionBinding,
        TransitionScope,
        execution_scope,
    )
    from mycelium.transition import derive_transition_key_for_call
    from mycelium.transition_resolution import resolve_side_effect_gate

    plan = _normalize_plan_injectors(plan, injector)
    by_name = {t.name: t for t in tools}
    yaml_text = build_yaml(
        tools, agent_id=agent_id, policy_version=policy_version, plan=plan
    )
    rt = _runtime_from_plan(tools, plan)
    storage = InMemoryLedgerStorage()
    # Enable provider reconcile only when the plan asks for crash_reconcile.
    use_reconcile = any(s.injector == "crash_reconcile" for s in plan)
    reconciler = _SandboxReconciler() if use_reconcile else None
    wrapped = _wrap_tools(
        rt,
        by_name,
        storage,
        agent_id=agent_id,
        policy_version=policy_version,
        reconciler=reconciler,
    )
    scope = TransitionScope(thread_id="sandbox", run_id="run-1", node="agent")
    gates: list[str] = []
    err: str | None = None

    def binding_for(name: str) -> ToolTransitionBinding:
        spec = by_name[name]
        return ToolTransitionBinding.for_tool(
            agent_id=agent_id,
            policy_version=policy_version,
            side_effect_class=SideEffectClass(spec.side_effect_class),
        )

    def step_kwargs(step: PlanStep) -> dict[str, Any]:
        kwargs = _tool_kwargs(step, by_name)
        kwargs["tool_call_id"] = step.tool_call_id
        return kwargs

    def request_id_for(step: PlanStep) -> str:
        return derive_transition_key_for_call(
            step.tool, (), step_kwargs(step), binding_for(step.tool)
        )

    def invoke(step: PlanStep) -> Any:
        rt.current_call_id = step.tool_call_id
        return wrapped[step.tool](**step_kwargs(step))

    def entry_for(step: PlanStep) -> Any:
        return storage.get(request_id_for(step))

    def gate_for(step: PlanStep) -> str | None:
        entry = entry_for(step)
        if entry is None:
            return None
        return resolve_side_effect_gate(entry, binding_for(step.tool)).value

    with execution_scope(scope):
        for step in plan:
            inj = step.injector
            try:
                if inj == "none":
                    invoke(step)
                elif inj == "redispatch":
                    invoke(step)
                    invoke(step)
                    g = gate_for(step) or "RETURN"
                    gates.append(g)
                    rt.log(
                        "redispatch",
                        f"{step.tool}: stored result returned",
                        gate=g,
                        call=step.tool_call_id,
                    )
                elif inj == "peer_slow":
                    rt.set_call_outcome(step.tool_call_id, "slow")
                    rt.slow_release = threading.Event()
                    rt.slow_entered = threading.Event()
                    peer_gate: list[str] = []
                    # Precompute on this thread - contextvars scope won't follow
                    # into the peer worker.
                    peer_request_id = request_id_for(step)
                    peer_binding = binding_for(step.tool)

                    def owner(s: PlanStep = step) -> None:
                        try:
                            invoke(s)
                        except Exception as exc:  # noqa: BLE001
                            msg = str(exc) or type(exc).__name__
                            rt.log("error", msg, tool=s.tool)
                        finally:
                            # Safety valve if the peer never releases.
                            rt.slow_release.set()

                    def peer(
                        s: PlanStep = step,
                        rid: str = peer_request_id,
                        binding: ToolTransitionBinding = peer_binding,
                    ) -> None:
                        if not rt.slow_entered.wait(timeout=2.0):
                            rt.log("peer", f"{s.tool}: peer gave up waiting for owner")
                            rt.slow_release.set()
                            return
                        try:
                            # Brief settle so the claim is visible in storage.
                            time.sleep(0.02)
                            entry = storage.get(rid)
                            if entry is not None:
                                g = resolve_side_effect_gate(entry, binding).value
                                peer_gate.append(g)
                                rt.log(
                                    "peer",
                                    f"{s.tool}: peer held (gate={g}) - no second body run",
                                )
                            else:
                                rt.log(
                                    "peer",
                                    f"{s.tool}: no in-flight entry; skipping second body",
                                )
                                peer_gate.append("POLL")
                        except Exception as exc:  # noqa: BLE001
                            msg = str(exc) or type(exc).__name__
                            rt.log("peer", f"{s.tool} peer: {msg}")
                        finally:
                            rt.slow_release.set()

                    # Contexts aren't thread-safe - one copy per worker.
                    owner_ctx = contextvars.copy_context()
                    t1 = threading.Thread(target=owner_ctx.run, args=(owner,))
                    # Peer only reads storage by precomputed id (no scope needed).
                    t2 = threading.Thread(target=peer)
                    t1.start()
                    t2.start()
                    t1.join(timeout=4)
                    t2.join(timeout=4)
                    rt.slow_release.set()
                    if peer_gate:
                        gates.append(peer_gate[0])
                    else:
                        g = gate_for(step)
                        if g:
                            gates.append(g)
                        elif rt.executions.get(step.tool, 0) <= 1:
                            gates.append("POLL")
                            rt.log(
                                "peer",
                                f"{step.tool}: inferred POLL (single execution)",
                                gate="POLL",
                                call=step.tool_call_id,
                            )
                elif inj == "crash_hard_block":
                    rt.set_call_outcome(step.tool_call_id, "timeout_after_effect")
                    try:
                        invoke(step)
                    except Exception as exc:  # noqa: BLE001
                        err = str(exc) or type(exc).__name__
                        rt.log("error", err, tool=step.tool)
                    try:
                        invoke(step)
                        gates.append("UNEXPECTED_ALLOW")
                        rt.log("retry", f"{step.tool}: unexpected allow on retry")
                    except LedgerHardBlockError:
                        gates.append("HARD_BLOCK")
                        # Keep the original crash timeout in `error` - clearer
                        # than the long ledger HARD_BLOCK message.
                        rt.log(
                            "retry",
                            f"{step.tool}: HARD_BLOCK on blind retry",
                            gate="HARD_BLOCK",
                            call=step.tool_call_id,
                        )
                elif inj == "crash_reconcile":
                    rt.set_call_outcome(step.tool_call_id, "timeout_after_effect")
                    try:
                        invoke(step)
                    except Exception as exc:  # noqa: BLE001
                        err = str(exc) or type(exc).__name__
                        rt.log("error", err, tool=step.tool)
                    try:
                        invoke(step)
                        g = gate_for(step) or "RETURN"
                        gates.append(g)
                        err = None  # crash resolved via provider - not a failure
                        n_rec = len(reconciler.calls) if reconciler else 0
                        rt.log(
                            "retry",
                            f"{step.tool}: provider reconcile confirmed "
                            f"COMPLETED (lookups={n_rec}) - no second body run",
                            gate=g,
                            call=step.tool_call_id,
                        )
                    except LedgerHardBlockError:
                        gates.append("HARD_BLOCK")
                        rt.log(
                            "retry",
                            f"{step.tool}: reconcile could not prove outcome; HARD_BLOCK",
                            gate="HARD_BLOCK",
                            call=step.tool_call_id,
                        )
            except Exception as exc:  # noqa: BLE001
                err = str(exc) or type(exc).__name__
                rt.log("error", err, tool=step.tool)

    return RunResult(
        mode="with",
        ok=True,
        executions=dict(rt.executions),
        events=rt.events,
        gate=_summarize_gates(gates),
        error=err,
        yaml_used=yaml_text,
    )


def run_sandbox(
    tools: list[ToolSpec],
    plan: list[PlanStep],
    *,
    injector: Injector = "none",
    mode: str = "both",
    agent_id: str = "sandbox-agent",
    policy_version: str = "2026.08.1",
) -> tuple[list[RunResult], str]:
    if not plan:
        plan = [PlanStep(tool="charge", tool_call_id="call_1", outcome="success")]
    tools = tools_from_plan(plan, tools)

    yaml_text = build_yaml(
        tools, agent_id=agent_id, policy_version=policy_version, plan=plan
    )
    results: list[RunResult] = []
    if mode in ("without", "both"):
        results.append(_run_plan_without(tools, plan, injector))
    if mode in ("with", "both"):
        results.append(
            _run_plan_with(
                tools,
                plan,
                injector,
                agent_id=agent_id,
                policy_version=policy_version,
            )
        )
    return results, yaml_text
