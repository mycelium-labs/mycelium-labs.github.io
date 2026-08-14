(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const rail = document.createElement("div");
  const canvas = document.createElement("canvas");
  rail.className = "thinking-orb-rail";
  rail.setAttribute("aria-hidden", "true");
  canvas.className = "thinking-orb";
  rail.append(canvas);
  document.body.append(rail);

  const ctx = canvas.getContext("2d");
  let size = 64;
  let phase = 0;
  let last = 0;
  let frame = 0;
  let visible = !document.hidden;
  let scrollProgress = 0;

  function resize() {
    size = parseFloat(getComputedStyle(rail).getPropertyValue("--orb-size")) || 64;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    position();
    draw();
  }

  function position() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    scrollProgress = Math.min(1, Math.max(0, scrollY / maxScroll));
    const start = innerHeight * (innerWidth <= 620 ? .16 : .14);
    const travel = innerHeight * (innerWidth <= 620 ? .66 : .72) - size;
    rail.style.setProperty("--orb-y", `${start + travel * scrollProgress}px`);
    const probe = document.elementFromPoint(innerWidth - Math.max(8, size / 2), start + travel * scrollProgress + size / 2);
    rail.classList.toggle("is-dark", Boolean(probe?.closest(".hero,.flow-section,.final-cta")));
  }

  function draw() {
    ctx.clearRect(0, 0, size, size);
    const color = getComputedStyle(rail).color;
    const scale = size / 64;
    const center = size / 2;
    ctx.fillStyle = color;

    for (let band = -3; band <= 3; band += 1) {
      for (let point = 0; point < 19; point += 1) {
        const t = point / 18;
        const x = 7 * scale + t * 50 * scale;
        const envelope = Math.sin(Math.PI * t);
        const wave = Math.sin(t * Math.PI * 2 + phase + band * .42);
        const y = center + band * 3.15 * scale + wave * envelope * 7.4 * scale;
        const depth = .3 + .7 * ((Math.cos(t * Math.PI * 2 + phase + band * .42) + 1) / 2);
        ctx.globalAlpha = depth * (.62 + .22 * envelope);
        ctx.beginPath();
        ctx.arc(x, y, (.72 + depth * .48) * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function animate(now) {
    if (!last) last = now;
    const delta = Math.min(40, now - last);
    last = now;
    phase += delta * .00155 * (1 + scrollProgress * .18);
    draw();
    frame = requestAnimationFrame(animate);
  }

  function start() {
    cancelAnimationFrame(frame);
    last = 0;
    if (visible && !reduced.matches) frame = requestAnimationFrame(animate);
  }

  addEventListener("scroll", position, { passive: true });
  addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => { visible = !document.hidden; start(); });
  reduced.addEventListener?.("change", () => { if (reduced.matches) phase = .8; draw(); start(); });
  resize();
  start();
  addEventListener("pagehide", () => cancelAnimationFrame(frame), { once: true });
})();
