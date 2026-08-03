/** Fun labels for failure modes (API values stay the same). */
const CHAOS_MODES = [
  { value: "redispatch", label: "retry storm", weight: 2 },
  { value: "peer_slow", label: "race condition", weight: 1 },
  { value: "crash_hard_block", label: "crash mid-flight", weight: 1 },
  { value: "crash_reconcile", label: "crash + provider check", weight: 1 },
];
const DEFAULT_CLASS = {
  search_docs: "read",
  lookup_order: "read",
  set_status: "idempotent_mutate",
  charge_keyed: "keyed_mutate",
  charge: "non_idempotent_mutate",
  refund: "non_idempotent_mutate",
  send_email: "non_idempotent_mutate",
  ship_order: "non_idempotent_mutate",
  create_ticket: "non_idempotent_mutate",
  post_slack: "non_idempotent_mutate",
  delete_account: "irreversible",
};

/** Plain-English verbs for story copy (tool id → doing / did / noun). */
const TOOL_VERBS = {
  search_docs: {
    doing: "searching docs",
    did: "searched docs",
    noun: "the search",
  },
  lookup_order: {
    doing: "looking up the order",
    did: "looked up the order",
    noun: "the order lookup",
  },
  set_status: {
    doing: "setting status",
    did: "set status",
    noun: "the status write",
  },
  charge_keyed: {
    doing: "charging with a key",
    did: "charged with a key",
    noun: "the keyed charge",
  },
  charge: { doing: "charging", did: "charged", noun: "the charge" },
  refund: { doing: "refunding", did: "refunded", noun: "the refund" },
  send_email: {
    doing: "sending email",
    did: "sent email",
    noun: "the email send",
  },
  ship_order: {
    doing: "shipping the order",
    did: "shipped the order",
    noun: "the shipment",
  },
  create_ticket: {
    doing: "creating a ticket",
    did: "created a ticket",
    noun: "the ticket create",
  },
  post_slack: {
    doing: "posting to Slack",
    did: "posted to Slack",
    noun: "the Slack post",
  },
  delete_account: {
    doing: "deleting the account",
    did: "deleted the account",
    noun: "the account delete",
  },
};

/**
 * Real-world stake of that tool doubling (not “next node in the graph”).
 * bad = without Mycelium; saved = ultimate outcome Mycelium protected.
 */
const TOOL_STAKES = {
  charge: {
    bad: (d) => `The customer was billed ${d || "$10"} twice.`,
    saved: (d) => `The customer was billed ${d || "$10"} only once.`,
  },
  charge_keyed: {
    bad: (d) => `A keyed charge of ${d || "$10"} ran more than once.`,
    saved: (d) => `A keyed charge of ${d || "$10"} ran only once.`,
  },
  refund: {
    bad: (d) => `The customer was refunded ${d || "$10"} twice.`,
    saved: (d) => `The customer was refunded ${d || "$10"} only once.`,
  },
  send_email: {
    bad: () => "The customer got the same email twice.",
    saved: () => "The customer got the email only once.",
  },
  ship_order: {
    bad: (d) => `The warehouse shipped ${d || "the order"} twice.`,
    saved: (d) => `The warehouse shipped ${d || "the order"} only once.`,
  },
  create_ticket: {
    bad: () => "Support opened the same ticket twice.",
    saved: () => "Support opened the ticket only once.",
  },
  post_slack: {
    bad: (d) => `${d || "#ops"} got the same alert twice.`,
    saved: (d) => `${d || "#ops"} got the alert only once.`,
  },
  set_status: {
    bad: () => "The same status write ran twice for no reason.",
    saved: () => "The status write ran only once.",
  },
  delete_account: {
    bad: () => "Delete ran more than once on the same account.",
    saved: () => "Delete ran only once on the account.",
  },
  search_docs: {
    bad: () => "Extra search work ran; usually harmless, still wasteful.",
    saved: () => "The duplicate search was skipped.",
  },
  lookup_order: {
    bad: () => "Extra lookup work ran; usually harmless, still wasteful.",
    saved: () => "The duplicate lookup was skipped.",
  },
};

function toolVerbs(tool) {
  if (TOOL_VERBS[tool]) return TOOL_VERBS[tool];
  const soft = String(tool || "the tool").replace(/_/g, " ");
  return { doing: soft, did: soft, noun: soft };
}

function toolNoun(tool) {
  return toolVerbs(tool).noun || String(tool || "the action").replace(/_/g, " ");
}

function nounList(tools) {
  const words = tools.map((t) => toolNoun(t));
  if (!words.length) return "the action";
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stakeLine(steps, kind) {
  const lines = (steps || [])
    .map((s) => {
      const fn = TOOL_STAKES[s.tool]?.[kind];
      if (!fn) return "";
      return fn(toolDetail(s));
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return joinLeads(lines);
}

const state = {
  nodes: [], // {id, tool, x, y, outcome, tool_call_id, addedAt}
  lastChaos: null, // { nodeId, tool, mode, label } rolled on last Run
  edges: [], // {from, to}
  seq: 1,
  /** Prefer this agent graph on Run (most recently added / interacted node). */
  focusNodeId: null,
  selectedIds: new Set(),
  marquee: null, // { x0, y0, x1, y1 } canvas coords while dragging
  connectFrom: null,
  drag: null,
  wire: null, // { fromId, x2, y2 } while dragging a connection
};

const NODE_W = 210;
const NODE_H = 72;

function wouldCreateCycle(fromId, toId) {
  // Walk forward from toId; if we reach fromId, from→to would loop.
  const adj = {};
  for (const e of state.edges) {
    (adj[e.from] || (adj[e.from] = [])).push(e.to);
  }
  const q = [toId];
  const seen = new Set();
  while (q.length) {
    const id = q.shift();
    if (id === fromId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const nxt of adj[id] || []) q.push(nxt);
  }
  return false;
}

function connectNodes(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return false;
  if (!nodeById(fromId) || !nodeById(toId)) return false;
  if (wouldCreateCycle(fromId, toId)) return false;
  // One out + one in per node → simple agent pipeline (no fan-out triangles)
  state.edges = state.edges.filter((e) => e.to !== toId && e.from !== fromId);
  state.edges.push({ from: fromId, to: toId });
  state.connectFrom = null;
  state.wire = null;
  connectHint.hidden = true;
  return true;
}

function cancelConnect() {
  state.connectFrom = null;
  state.wire = null;
  connectHint.hidden = true;
  canvas.querySelectorAll(".node.selected, .port.hot").forEach((el) => {
    el.classList.remove("selected", "hot");
  });
  drawEdges();
}

function canvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function nodeIdFromPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const node = el?.closest?.(".node");
  return node?.dataset?.id || null;
}

const canvas = document.getElementById("canvas");
const edgesSvg = document.getElementById("edges");
const emptyEl = document.getElementById("canvasEmpty");
const connectHint = document.getElementById("connectHint");

function uid(prefix) {
  return `${prefix}_${state.seq++}`;
}

function addNode(tool, x = 80, y = 80) {
  const id = uid("n");
  state.nodes.push({
    id,
    tool,
    x,
    y,
    outcome: "success",
    tool_call_id: uid("call"),
    addedAt: state.seq,
  });
  state.focusNodeId = id;
  render();
  return id;
}

function removeNode(id) {
  removeNodes([id]);
}

function removeNodes(ids) {
  const doomed = new Set(ids.filter(Boolean));
  if (!doomed.size) return;
  state.nodes = state.nodes.filter((n) => !doomed.has(n.id));
  state.edges = state.edges.filter(
    (e) => !doomed.has(e.from) && !doomed.has(e.to),
  );
  for (const id of doomed) state.selectedIds.delete(id);
  if (doomed.has(state.focusNodeId)) {
    const newest = [...state.nodes].sort(
      (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    )[0];
    state.focusNodeId = newest?.id || null;
  }
  if (state.lastChaos && doomed.has(state.lastChaos.nodeId)) {
    state.lastChaos = null;
  }
  render();
}

function clearSelection() {
  if (!state.selectedIds.size) return;
  state.selectedIds.clear();
  canvas.querySelectorAll(".node.picked").forEach((el) => {
    el.classList.remove("picked");
  });
}

function marqueeRect(m) {
  const x = Math.min(m.x0, m.x1);
  const y = Math.min(m.y0, m.y1);
  const w = Math.abs(m.x1 - m.x0);
  const h = Math.abs(m.y1 - m.y0);
  return { x, y, w, h, x2: x + w, y2: y + h };
}

function syncMarqueeEl() {
  let el = document.getElementById("marquee");
  if (!state.marquee) {
    if (el) el.hidden = true;
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "marquee";
    el.className = "marquee";
    canvas.appendChild(el);
  }
  const r = marqueeRect(state.marquee);
  el.hidden = false;
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

function selectNodesInMarquee() {
  if (!state.marquee) return;
  const r = marqueeRect(state.marquee);
  // Ignore tiny accidental drags
  if (r.w < 4 && r.h < 4) {
    state.selectedIds.clear();
    return;
  }
  const hit = new Set();
  for (const n of state.nodes) {
    const nx1 = n.x;
    const ny1 = n.y;
    const nx2 = n.x + NODE_W;
    const ny2 = n.y + NODE_H;
    const overlaps =
      nx1 < r.x2 && nx2 > r.x && ny1 < r.y2 && ny2 > r.y;
    if (overlaps) hit.add(n.id);
  }
  state.selectedIds = hit;
}

function nodeById(id) {
  return state.nodes.find((n) => n.id === id);
}

function focusNode(id) {
  if (!id || !nodeById(id)) return;
  state.focusNodeId = id;
}

/** Undirected connected component containing `startId`. */
function componentIds(startId) {
  if (!startId || !nodeById(startId)) return new Set();
  const undirected = {};
  for (const n of state.nodes) undirected[n.id] = [];
  for (const e of state.edges) {
    if (!undirected[e.from] || !undirected[e.to]) continue;
    undirected[e.from].push(e.to);
    undirected[e.to].push(e.from);
  }
  const seen = new Set([startId]);
  const q = [startId];
  while (q.length) {
    const id = q.shift();
    for (const nxt of undirected[id] || []) {
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      q.push(nxt);
    }
  }
  return seen;
}

/** Which node decides the active agent when several graphs are on the canvas. */
function activeFocusId() {
  if (state.focusNodeId && nodeById(state.focusNodeId)) return state.focusNodeId;
  const newest = [...state.nodes].sort(
    (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
  )[0];
  return newest?.id || null;
}

function topoPlan() {
  const focus = activeFocusId();
  const active = focus ? componentIds(focus) : new Set(state.nodes.map((n) => n.id));
  const ids = state.nodes.map((n) => n.id).filter((id) => active.has(id));
  const indeg = Object.fromEntries(ids.map((id) => [id, 0]));
  const adj = Object.fromEntries(ids.map((id) => [id, []]));
  for (const e of state.edges) {
    if (!adj[e.from] || indeg[e.to] === undefined) continue;
    adj[e.from].push(e.to);
    indeg[e.to] += 1;
  }
  const q = ids.filter((id) => indeg[id] === 0);
  // stable: left-to-right among roots
  q.sort((a, b) => nodeById(a).x - nodeById(b).x);
  const ordered = [];
  while (q.length) {
    const id = q.shift();
    ordered.push(id);
    for (const nxt of adj[id]) {
      indeg[nxt] -= 1;
      if (indeg[nxt] === 0) {
        q.push(nxt);
        q.sort((a, b) => nodeById(a).x - nodeById(b).x);
      }
    }
  }
  // cycles / leftovers: append by x
  if (ordered.length < ids.length) {
    const left = ids
      .filter((id) => !ordered.includes(id))
      .sort((a, b) => nodeById(a).x - nodeById(b).x);
    ordered.push(...left);
  }
  return ordered.map((id) => {
    const n = nodeById(id);
    return {
      id: n.id,
      tool: n.tool,
      tool_call_id: n.tool_call_id,
      outcome: n.outcome,
      side_effect_class: DEFAULT_CLASS[n.tool] || "non_idempotent_mutate",
      injector: "none",
    };
  });
}

function pickWeighted(modes) {
  const total = modes.reduce((s, m) => s + (m.weight || 1), 0);
  let r = Math.random() * total;
  for (const m of modes) {
    r -= m.weight || 1;
    if (r <= 0) return m;
  }
  return modes[0];
}

/** Roll chaos onto one mutating tool so watchers never configure injectors. */
function rollChaos(plan) {
  const mutates = plan.filter(
    (p) => (DEFAULT_CLASS[p.tool] || "non_idempotent_mutate") !== "read",
  );
  const pool = mutates.length ? mutates : plan;
  if (!pool.length) {
    return { plan, chaos: null };
  }
  const target = pool[Math.floor(Math.random() * pool.length)];
  const mode = pickWeighted(CHAOS_MODES);
  const rolled = plan.map((p) => ({
    ...p,
    injector: p.tool_call_id === target.tool_call_id ? mode.value : "none",
  }));
  return {
    plan: rolled,
    chaos: {
      nodeId: target.id,
      tool: target.tool,
      mode: mode.value,
      label: mode.label,
    },
  };
}

function scrollToCompare() {
  const el = document.getElementById("comparePanel");
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

/** Visual center of a port, in SVG/canvas pixel space. */
function portCenter(nodeEl, side) {
  const canvasRect = canvas.getBoundingClientRect();
  const port = nodeEl.querySelector(`.port.${side}`);
  if (port) {
    const r = port.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - canvasRect.left,
      y: r.top + r.height / 2 - canvasRect.top,
    };
  }
  const n = nodeEl.getBoundingClientRect();
  return {
    x: (side === "out" ? n.right : n.left) - canvasRect.left,
    y: n.top + n.height / 2 - canvasRect.top,
  };
}

/** Smooth horizontal cubic between ports (node-editor style). */
function curvePath(p1, p2) {
  const dx = Math.max(48, Math.abs(p2.x - p1.x) * 0.5);
  return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
}

function drawEdges() {
  const canvasRect = canvas.getBoundingClientRect();
  const w = Math.max(canvasRect.width, 1);
  const h = Math.max(canvasRect.height, 1);
  // Keep SVG pixel space identical to getBoundingClientRect space
  edgesSvg.setAttribute("width", String(w));
  edgesSvg.setAttribute("height", String(h));
  edgesSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  edgesSvg.setAttribute("preserveAspectRatio", "none");
  edgesSvg.style.width = `${w}px`;
  edgesSvg.style.height = `${h}px`;
  edgesSvg.innerHTML = "";

  for (const e of state.edges) {
    const a = canvas.querySelector(`.node[data-id="${e.from}"]`);
    const b = canvas.querySelector(`.node[data-id="${e.to}"]`);
    if (!a || !b) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", curvePath(portCenter(a, "out"), portCenter(b, "in")));
    edgesSvg.appendChild(path);
  }
  if (state.wire) {
    const a = canvas.querySelector(`.node[data-id="${state.wire.fromId}"]`);
    if (a) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        curvePath(portCenter(a, "out"), {
          x: state.wire.x2,
          y: state.wire.y2,
        }),
      );
      path.classList.add("wire-temp");
      edgesSvg.appendChild(path);
    }
  }
}

function render() {
  emptyEl.hidden = state.nodes.length > 0;
  // remove old nodes
  canvas.querySelectorAll(".node").forEach((n) => n.remove());

  for (const n of state.nodes) {
    const chaos =
      state.lastChaos && state.lastChaos.nodeId === n.id
        ? state.lastChaos
        : null;
    const node = document.createElement("div");
    node.className =
      "node" +
      (chaos ? " node-chaos-hit" : "") +
      (state.selectedIds.has(n.id) ? " picked" : "");
    node.dataset.id = n.id;
    node.style.left = `${n.x}px`;
    node.style.top = `${n.y}px`;

    const head = document.createElement("div");
    head.className = "node-head";
    head.innerHTML = `<strong>${n.tool}</strong>`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "node-del";
    del.title = "Remove";
    del.textContent = "×";
    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      removeNode(n.id);
    });
    head.appendChild(del);

    head.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button, select")) return;
      focusNode(n.id);
      const startX = ev.clientX;
      const startY = ev.clientY;
      const origX = n.x;
      const origY = n.y;
      state.drag = { id: n.id, startX, startY, origX, origY };
      head.setPointerCapture(ev.pointerId);
    });
    head.addEventListener("pointermove", (ev) => {
      if (!state.drag || state.drag.id !== n.id) return;
      n.x = Math.max(8, state.drag.origX + (ev.clientX - state.drag.startX));
      n.y = Math.max(8, state.drag.origY + (ev.clientY - state.drag.startY));
      node.style.left = `${n.x}px`;
      node.style.top = `${n.y}px`;
      drawEdges();
    });
    head.addEventListener("pointerup", () => {
      state.drag = null;
    });

    const pin = document.createElement("div");
    pin.className = "port in";
    pin.title = "Drop a connection here (left port)";
    pin.addEventListener("pointerup", (ev) => {
      ev.stopPropagation();
      if (!state.connectFrom || state.connectFrom === n.id) return;
      if (connectNodes(state.connectFrom, n.id)) render();
    });
    pin.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!state.connectFrom || state.connectFrom === n.id) return;
      if (connectNodes(state.connectFrom, n.id)) render();
    });

    const pout = document.createElement("div");
    pout.className = "port out";
    pout.title = "Drag to another tool to connect (right port)";
    pout.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      focusNode(n.id);
      state.connectFrom = n.id;
      connectHint.hidden = false;
      const pt = canvasPoint(ev.clientX, ev.clientY);
      state.wire = { fromId: n.id, x2: pt.x, y2: pt.y };
      canvas.querySelectorAll(".node").forEach((el) => {
        el.classList.toggle("selected", el.dataset.id === n.id);
      });
      pout.classList.add("hot");
      pout.setPointerCapture(ev.pointerId);
      drawEdges();
    });
    pout.addEventListener("pointermove", (ev) => {
      if (state.connectFrom !== n.id || !state.wire) return;
      const pt = canvasPoint(ev.clientX, ev.clientY);
      state.wire.x2 = pt.x;
      state.wire.y2 = pt.y;
      const overId = nodeIdFromPoint(ev.clientX, ev.clientY);
      canvas.querySelectorAll(".port.in").forEach((el) => {
        const id = el.closest(".node")?.dataset?.id;
        el.classList.toggle("hot", Boolean(overId && id === overId && id !== n.id));
      });
      drawEdges();
    });
    pout.addEventListener("pointerup", (ev) => {
      ev.stopPropagation();
      if (state.connectFrom !== n.id) return;
      const toId = nodeIdFromPoint(ev.clientX, ev.clientY);
      if (toId && toId !== n.id && connectNodes(n.id, toId)) {
        render();
        return;
      }
      // Keep click-to-connect armed if they released on empty canvas
      state.wire = null;
      drawEdges();
    });

    // Clicking the card while a wire is armed finishes the link;
    // otherwise focuses this agent for Run.
    node.addEventListener("click", (ev) => {
      if (ev.target.closest("button, select, .port")) return;
      if (state.connectFrom && state.connectFrom !== n.id) {
        if (connectNodes(state.connectFrom, n.id)) render();
        return;
      }
      if (!ev.shiftKey) state.selectedIds.clear();
      state.selectedIds.add(n.id);
      focusNode(n.id);
      render();
    });

    node.appendChild(head);
    if (chaos) {
      const badge = document.createElement("div");
      badge.className = "node-chaos";
      badge.textContent = chaos.label;
      badge.title = `Chaos preset: ${chaos.label} (${chaos.mode})`;
      node.appendChild(badge);
    }
    node.append(pin, pout);
    canvas.appendChild(node);
  }
  requestAnimationFrame(drawEdges);
}

function formatResult(r) {
  const lines = [];
  if (r.gate) lines.push(`gate: ${r.gate}`);
  lines.push(`executions: ${JSON.stringify(r.executions)}`);
  if (r.error) lines.push(`error: ${r.error}`);
  lines.push("");
  for (const e of r.events || []) {
    const call = e.detail?.call ? ` @${e.detail.call}` : "";
    lines.push(`[${e.kind}] ${e.message}${call}`);
  }
  return lines.join("\n") || "-";
}

function money(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "$10";
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function timesWord(n) {
  if (n === 1) return "once";
  if (n === 2) return "twice";
  return `${n} times`;
}

/** Steps the story should talk about: injected ones, else anything that duplicated. */
function storySteps(plan, execWithout) {
  const steps = plan || [];
  const injected = steps.filter((p) => p.injector && p.injector !== "none");
  if (injected.length) return injected;
  const duped = steps.filter((p) => (execWithout?.[p.tool] || 0) >= 2);
  if (duped.length) return duped;
  return steps.length ? [steps[0]] : [];
}

function toolDetail(step) {
  const tool = step.tool;
  if (tool === "charge" || tool === "refund" || tool === "charge_keyed") {
    return money(step.amount ?? 10);
  }
  if (tool === "ship_order") return step.order_id || "ord_1001";
  if (tool === "post_slack") return step.channel || "#ops";
  return "";
}

/** Dynamic lead from live counts + verb map. */
function toolRanLead(step, count) {
  const tool = step.tool;
  const { did } = toolVerbs(tool);
  const detail = toolDetail(step);
  const when = timesWord(count || 1);
  const Did = capitalize(did);
  if (tool === "charge" || tool === "refund" || tool === "charge_keyed") {
    if (count >= 2) return `${Did} ${when} (${detail} each time).`;
    return `${Did} once for ${detail}.`;
  }
  if (detail) {
    if (count >= 2) return `${Did} ${when} for ${detail}.`;
    return `${Did} once for ${detail}.`;
  }
  return `${Did} ${when}.`;
}

function joinLeads(parts) {
  if (!parts.length) return "Run finished.";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
  return `${parts.slice(0, -1).join(" ")} ${parts[parts.length - 1]}`;
}

function verbList(tools, form = "doing") {
  const words = tools.map((t) => toolVerbs(t)[form] || t);
  if (!words.length) return "the action";
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

function dominantInjector(steps) {
  const order = [
    "crash_reconcile",
    "crash_hard_block",
    "peer_slow",
    "redispatch",
  ];
  for (const inj of order) {
    if (steps.some((s) => s.injector === inj)) return inj;
  }
  return steps[0]?.injector || "none";
}

/** Tools that ran ≥2 without Mycelium and ≤1 with it. */
function preventedSteps(plan, execWithout, execWith) {
  return (plan || []).filter((s) => {
    const bad = execWithout?.[s.tool] || 0;
    const good = execWith?.[s.tool] || 0;
    return bad >= 2 && good <= 1;
  });
}

/** Dynamic "Prevented sending email twice" from real count diffs. */
function preventedLead(steps, execWithout) {
  if (!steps.length) return "";
  const bits = steps.map((s) => {
    const n = execWithout?.[s.tool] || 2;
    const doing = toolVerbs(s.tool).doing;
    const detail = toolDetail(s);
    const extra = detail ? ` (${detail})` : "";
    if (n === 2) return `${doing}${extra}`;
    return `${doing}${extra} (${n} times)`;
  });
  if (bits.length === 1) {
    const n = execWithout?.[steps[0].tool] || 2;
    if (n === 2) return `Prevented ${bits[0]} twice.`;
    return `Prevented ${bits[0]} from repeating.`;
  }
  if (bits.length === 2) return `Prevented ${bits[0]} and ${bits[1]} from running twice.`;
  return `Prevented ${bits.slice(0, -1).join(", ")}, and ${bits.at(-1)} from running twice.`;
}

/** Mode-specific stories - each gate gets its own framing, not a generic “ran once”. */

function crashAmbiguousStory({ guarded, tools, focus }) {
  const noun = nounList(tools);
  const risk = stakeLine(focus, "bad");
  if (!guarded) {
    return {
      badge: "Blind retry",
      lead: `${capitalize(noun)} crashed mid-flight, then the agent retried without knowing if it already succeeded.`,
      sub: [
        "No proof either way, so the body ran again.",
        risk ? `Risk: ${risk}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  return {
    badge: "Retry blocked",
    lead: `Mycelium blocked the retry because ${noun} crashed with an ambiguous outcome.`,
    sub: "Until the provider can prove what happened, a second run is unsafe.",
  };
}

function crashReconcileStory({ guarded, tools, focus }) {
  const noun = nounList(tools);
  if (!guarded) {
    return crashAmbiguousStory({ guarded, tools, focus });
  }
  return {
    badge: "Reconciled",
    lead: `After the crash, Mycelium checked the provider and confirmed ${noun} already happened.`,
    sub: "It returned that result with no second body run. If the provider could not prove it, this would hard-block instead.",
  };
}

function raceStory({ guarded, tools, focus, maxCount }) {
  const noun = nounList(tools);
  const risk = stakeLine(focus, "bad");
  const saved = stakeLine(focus, "saved");
  if (!guarded) {
    return {
      badge: "Race",
      lead: risk || `Two workers both ran ${noun} at the same time.`,
      sub: [
        maxCount >= 2
          ? `Both bodies executed (${timesWord(maxCount)}).`
          : "Concurrent callers overlapped.",
        "Nothing held the second worker back.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  return {
    badge: "Peer held",
    lead: saved || `Only one worker ran ${noun}.`,
    sub: "Mycelium held the second caller until the first finished, then shared the result.",
  };
}

function retryDedupeStory({ guarded, tools, focus, maxCount, lead }) {
  const noun = nounList(tools);
  const risk = stakeLine(focus, "bad");
  const saved = stakeLine(focus, "saved");
  if (!guarded) {
    return {
      badge: maxCount >= 2 ? "Ran twice" : "Unguarded retry",
      lead: risk || lead || `Same call came back and ${noun} ran again.`,
      sub: "Same call id, no ledger - so the body ran a second time.",
    };
  }
  return {
    badge: "Returned result",
    lead: saved || `Mycelium returned the stored result for ${noun}.`,
    sub: "Same call id came back; Mycelium reused the first result instead of running the body again.",
  };
}

/** Plain-English outcome built from the live plan + execution counts. */
function humanStory({
  guarded,
  executions,
  plan,
  execWithout,
  execWith,
  error,
  gate,
}) {
  const focus = storySteps(plan, execWithout || executions);
  const exec = executions || {};
  const tools = focus.map((s) => s.tool);
  const counts = focus.map((s) => exec[s.tool] || 0);
  const maxCount = Math.max(0, ...counts);
  const inj = dominantInjector(focus);
  const g = String(gate || "");
  const isRead = (t) =>
    DEFAULT_CLASS[t] === "read" || t === "search_docs" || t === "lookup_order";
  const leads = focus.map((s) => toolRanLead(s, exec[s.tool] || 0));
  const lead = joinLeads(leads);

  // Prefer injector framing; fall back to gate when injector missing.
  if (inj === "crash_hard_block" || (guarded && /HARD_BLOCK/i.test(g) && inj !== "crash_reconcile")) {
    return crashAmbiguousStory({ guarded, tools, focus });
  }
  if (inj === "crash_reconcile") {
    return crashReconcileStory({ guarded, tools, focus });
  }
  if (inj === "peer_slow" || (guarded && /POLL/i.test(g))) {
    return raceStory({ guarded, tools, focus, maxCount });
  }
  if (inj === "redispatch" || (guarded && /RETURN/i.test(g))) {
    return retryDedupeStory({ guarded, tools, focus, maxCount, lead });
  }

  if (error && maxCount === 0) {
    return {
      badge: guarded ? "Blocked" : "Failed",
      lead: guarded
        ? "Mycelium blocked an unsafe retry."
        : "The run failed partway through.",
      sub: String(error),
    };
  }

  if (
    !guarded &&
    inj === "none" &&
    focus.length === 1 &&
    isRead(focus[0].tool) &&
    maxCount <= 1
  ) {
    return {
      badge: "Read",
      lead: toolRanLead(focus[0], maxCount || 1),
      sub: "Reads are safe to repeat. Mutating tools are not.",
    };
  }

  if (!guarded) {
    const badStake = stakeLine(focus, "bad");
    if (maxCount >= 2) {
      return {
        badge: maxCount === 2 ? "Ran twice" : `Ran ${maxCount} times`,
        lead: badStake || lead,
        sub: [
          lead,
          "No guard was in place; the call ran more than once.",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
    return {
      badge: "Unguarded",
      lead,
      sub: "No guard was in place if a retry happened.",
    };
  }

  if (maxCount >= 2) {
    return {
      badge: "Still duplicated",
      lead,
      sub: "Unexpected under Mycelium. Check the technical log.",
    };
  }

  const prevented = preventedSteps(
    plan,
    execWithout || {},
    execWith || executions || {},
  );
  const preventedLine = preventedLead(prevented, execWithout || {});
  const savedStake = stakeLine(prevented.length ? prevented : focus, "saved");

  return {
    badge: "Guarded",
    lead: savedStake || preventedLine || lead || "No duplicate call got through.",
    sub: g ? `Gate: ${g}` : "Mycelium stopped the unsafe call.",
  };
}

function renderStory(elId, story) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  const badge = document.createElement("div");
  badge.className = "story-badge";
  badge.textContent = story.badge;
  const lead = document.createElement("p");
  lead.className = "story-lead";
  lead.textContent = story.lead;
  const sub = document.createElement("p");
  sub.className = "story-sub";
  sub.textContent = story.sub;
  el.append(badge, lead, sub);
}

function clearChips() {
  document.querySelectorAll(".col .chip").forEach((c) => c.remove());
}

function setCmd(elId, text) {
  const el = document.getElementById(elId);
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = `$ ${text}`;
}

async function run() {
  const btn = document.getElementById("btnRun");
  const basePlan = topoPlan();
  if (!basePlan.length) {
    alert("Add at least one tool node.");
    return;
  }
  const focus = activeFocusId();
  const active = focus ? componentIds(focus) : new Set();
  const skipped = state.nodes.length - active.size;
  const { plan, chaos } = rollChaos(basePlan);
  state.lastChaos = chaos;
  render(); // show rolled chaos preset on the hit node
  btn.disabled = true;
  document.getElementById("compareTitle").textContent = "What happened?";
  const skipNote =
    skipped > 0
      ? ` Running the latest agent (${active.size} tool${active.size === 1 ? "" : "s"}); ${skipped} other tool${skipped === 1 ? "" : "s"} skipped - click a node to switch.`
      : "";
  document.getElementById("compareHint").textContent = chaos
    ? `Rolled: ${chaos.label} on ${toolVerbs(chaos.tool).doing}. Same graph twice - unprotected vs Mycelium.${skipNote}`
    : `Same agent graph twice - once unprotected, once with Mycelium.${skipNote}`;
  document.getElementById("titleWithout").textContent = "Without Mycelium";
  document.getElementById("titleWith").textContent = "With Mycelium";
  setCmd("cmdWithout", "");
  setCmd("cmdWith", "");
  clearChips();
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan,
        tools: [],
        injector: "none",
        mode: "both",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById("logWithout").textContent = data.detail || "error";
      document.getElementById("logWith").textContent = "-";
      renderStory("storyWithout", {
        badge: "Error",
        lead: "Couldn’t run this scenario.",
        sub: String(data.detail || "error"),
      });
      renderStory("storyWith", {
        badge: "-",
        lead: "No result.",
        sub: "Fix the error on the left and try again.",
      });
      scrollToCompare();
      return;
    }
    document.getElementById("yamlBox").textContent = data.yaml_preview || "";
    const yamlDetails = document.getElementById("yamlDetails");
    if (yamlDetails && data.yaml_preview) {
      // Reveal YAML after the first successful run; keep collapsed.
      yamlDetails.open = false;
      const hint = yamlDetails.querySelector(".hint-inline");
      if (hint) hint.textContent = "mycelium.yaml";
    }
    const without = data.results.find((r) => r.mode === "without");
    const withM = data.results.find((r) => r.mode === "with");
    document.getElementById("logWithout").textContent = without
      ? formatResult(without)
      : "-";
    document.getElementById("logWith").textContent = withM ? formatResult(withM) : "-";

    renderStory(
      "storyWithout",
      humanStory({
        guarded: false,
        executions: without?.executions,
        execWithout: without?.executions,
        execWith: withM?.executions,
        gate: without?.gate,
        plan,
        error: without?.error,
      }),
    );
    renderStory(
      "storyWith",
      humanStory({
        guarded: true,
        executions: withM?.executions,
        execWithout: without?.executions,
        execWith: withM?.executions,
        gate: withM?.gate,
        plan,
        error: withM?.error,
      }),
    );
    scrollToCompare();
  } finally {
    btn.disabled = false;
  }
}

// Palette
for (const btn of document.querySelectorAll(".palette-item")) {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool;
    const n = state.nodes.length;
    addNode(tool, 60 + (n % 3) * 230, 50 + Math.floor(n / 3) * 200);
  });
  btn.addEventListener("dragstart", (ev) => {
    ev.dataTransfer.setData("text/tool", btn.dataset.tool);
  });
}

canvas.addEventListener("dragover", (ev) => ev.preventDefault());
canvas.addEventListener("drop", (ev) => {
  ev.preventDefault();
  const tool = ev.dataTransfer.getData("text/tool");
  if (!tool) return;
  const rect = canvas.getBoundingClientRect();
  addNode(tool, ev.clientX - rect.left - 100, ev.clientY - rect.top - 20);
});

canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  if (ev.target.closest(".node, .port, button")) return;
  if (state.connectFrom) {
    cancelConnect();
    return;
  }
  const pt = canvasPoint(ev.clientX, ev.clientY);
  state.marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
  if (!ev.shiftKey) {
    state.selectedIds.clear();
    canvas.querySelectorAll(".node.picked").forEach((el) => {
      el.classList.remove("picked");
    });
  }
  canvas.classList.add("is-marquee");
  canvas.setPointerCapture(ev.pointerId);
  syncMarqueeEl();
});

canvas.addEventListener("pointermove", (ev) => {
  if (!state.marquee) return;
  const pt = canvasPoint(ev.clientX, ev.clientY);
  state.marquee.x1 = pt.x;
  state.marquee.y1 = pt.y;
  syncMarqueeEl();
});

canvas.addEventListener("pointerup", (ev) => {
  if (!state.marquee) return;
  const pt = canvasPoint(ev.clientX, ev.clientY);
  state.marquee.x1 = pt.x;
  state.marquee.y1 = pt.y;
  const additive = ev.shiftKey ? new Set(state.selectedIds) : new Set();
  selectNodesInMarquee();
  if (additive.size) {
    for (const id of additive) state.selectedIds.add(id);
  }
  state.marquee = null;
  canvas.classList.remove("is-marquee");
  syncMarqueeEl();
  if (state.selectedIds.size) {
    const first = [...state.selectedIds][0];
    focusNode(first);
  }
  render();
});

canvas.addEventListener("click", (ev) => {
  if (ev.target.closest(".node, .port")) return;
  if (state.connectFrom) cancelConnect();
});

window.addEventListener("keydown", (ev) => {
  if (ev.target.closest("input, textarea, select, [contenteditable]")) return;
  if (ev.key === "Escape") {
    if (state.connectFrom) cancelConnect();
    clearSelection();
    render();
    return;
  }
  if (ev.key === "Delete" || ev.key === "Backspace") {
    if (!state.selectedIds.size) return;
    ev.preventDefault();
    removeNodes([...state.selectedIds]);
  }
});

function clearLayout() {
  state.nodes = [];
  state.edges = [];
  state.lastChaos = null;
  state.focusNodeId = null;
  state.selectedIds.clear();
  state.marquee = null;
  state.connectFrom = null;
  state.wire = null;
  state.drag = null;
  cancelConnect();
  syncMarqueeEl();
  document.getElementById("yamlBox").textContent = "# run to generate mycelium.yaml";
  const yamlDetails = document.getElementById("yamlDetails");
  if (yamlDetails) {
    yamlDetails.open = false;
    const hint = yamlDetails.querySelector(".hint-inline");
    if (hint) hint.textContent = "after run";
  }
  document.getElementById("compareTitle").textContent = "What happened?";
  document.getElementById("compareHint").textContent =
    "Same agent graph twice: once unprotected, once with Mycelium. Read the outcome in plain English first.";
  document.getElementById("logWithout").textContent = "-";
  document.getElementById("logWith").textContent = "-";
  setCmd("cmdWithout", "");
  setCmd("cmdWith", "");
  clearChips();
  for (const id of ["storyWithout", "storyWith"]) {
    const el = document.getElementById(id);
    el.innerHTML =
      '<p class="story-lead">Run a scenario to see the real-world effect.</p>';
  }
  render();
}

function setupPaletteToggle() {
  const btn = document.getElementById("btnTogglePalette");
  const body = document.getElementById("paletteBody");
  if (!btn || !body) return;
  const mq = window.matchMedia("(min-width: 960px)");

  const sync = () => {
    if (mq.matches) {
      body.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      btn.textContent = "Hide";
      return;
    }
    const open = btn.getAttribute("aria-expanded") === "true";
    body.hidden = !open;
    btn.textContent = open ? "Hide" : "Show";
  };

  btn.addEventListener("click", () => {
    if (mq.matches) return;
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", open ? "false" : "true");
    sync();
  });

  // Mobile starts collapsed (aria-expanded=false in HTML).
  mq.addEventListener("change", sync);
  sync();
}

document.getElementById("btnRun").addEventListener("click", () => {
  run().catch(console.error);
});

document.getElementById("btnClear").addEventListener("click", clearLayout);

setupPaletteToggle();

window.addEventListener("resize", () => drawEdges());

// Seed a linear agent: charge → ship_order → send_email (same Y, straight wires)
(function seed() {
  const y = 72;
  const gap = 252;
  const tools = ["charge", "ship_order", "send_email"];
  const ids = tools.map((tool, i) => {
    const id = uid("n");
    state.nodes.push({
      id,
      tool,
      x: 48 + i * gap,
      y,
      outcome: "success",
      tool_call_id: uid("call"),
      addedAt: state.seq,
    });
    return id;
  });
  state.edges = [
    { from: ids[0], to: ids[1] },
    { from: ids[1], to: ids[2] },
  ];
  state.focusNodeId = ids[ids.length - 1];
  render();
  requestAnimationFrame(() => requestAnimationFrame(drawEdges));
})();
