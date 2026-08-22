(() => {
  const rings = {
    a: '<path d="M63 94c98-72 235-66 322-18 91 51 158 158 118 263-45 119-194 199-329 154C39 448-26 323 21 211 33 181 46 128 63 94Z"/><path d="M100 128c77-55 190-56 268-16 83 43 132 127 104 213-32 98-151 163-258 132C97 423 39 325 71 235c13-37 15-78 29-107Z"/><path d="M145 165c61-42 143-41 201-9 65 36 98 96 80 162-22 77-112 124-193 103-89-24-128-101-106-169 10-32 5-62 18-87Z"/>',
    b: '<path d="M72 58c118-54 268-42 356 28 86 70 148 188 96 292-58 116-228 198-362 146C28 472-18 338 26 214 42 172 52 104 72 58Z"/><path d="M118 102c90-48 208-40 282 16 76 52 128 148 90 232-40 94-168 158-276 120C88 434 38 328 74 236c14-34 22-88 44-134Z"/><path d="M168 148c62-36 156-32 218 10 58 40 94 108 72 172-26 78-124 132-206 106-88-28-126-108-98-174 10-26 8-72 14-114Z"/>'
  };
  const svg = (ring, extra) =>
    `<svg class="section-contour ${extra}" viewBox="0 0 600 600" aria-hidden="true" focusable="false">${rings[ring]}</svg>`;
  document.querySelectorAll("[data-contour]").forEach((el, i) => {
    const side = el.dataset.contour || "right";
    const ring = el.dataset.contourRing || (i % 2 ? "b" : "a");
    const other = ring === "a" ? "b" : "a";
    el.classList.add("contour-section");
    if (side === "both") {
      el.insertAdjacentHTML("afterbegin", svg(other, "section-contour--left"));
      el.insertAdjacentHTML("afterbegin", svg(ring, ""));
      return;
    }
    el.insertAdjacentHTML("afterbegin", svg(ring, side === "left" ? "section-contour--left" : side === "dark" ? "section-contour--dark" : ""));
  });
  const copy = async button => {
    const state = button.querySelector(".copy-state");
    try { await navigator.clipboard.writeText(button.dataset.copy); }
    catch (_) {
      const area = document.createElement("textarea");
      area.value = button.dataset.copy;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    if (state) {
      state.textContent = "Copied ✓";
      setTimeout(() => { state.textContent = "Copy"; }, 1500);
    }
  };
  document.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", () => copy(b)));
  const reveals = document.querySelectorAll("[data-reveal]");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    reveals.forEach(x => x.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("is-visible"); observer.unobserve(e.target); }
    }), { threshold: .12 });
    reveals.forEach(x => observer.observe(x));
  }

  const carousel = document.querySelector(".report-carousel");
  if (carousel) {
    const slides = [...carousel.querySelectorAll("[data-report-slide]")];
    const current = carousel.querySelector("[data-report-current]");
    let active = 0;
    const show = index => {
      active = (index + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        const selected = i === active;
        slide.classList.toggle("is-active", selected);
        slide.setAttribute("aria-hidden", String(!selected));
      });
      if (current) current.textContent = String(active + 1).padStart(2, "0");
    };
    carousel.querySelector("[data-report-prev]")?.addEventListener("click", () => show(active - 1));
    carousel.querySelector("[data-report-next]")?.addEventListener("click", () => show(active + 1));
  }

  const hero = document.querySelector(".immersive-hero");
  const canvas = hero?.querySelector(".spore-field");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (hero && canvas) {
    const context = canvas.getContext("2d");
    const spores = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    const seedSpore = (spore = {}) => Object.assign(spore, {
      x: Math.random() * width,
      y: Math.random() * height,
      radius: .7 + Math.random() * 2.4,
      speed: .08 + Math.random() * .28,
      drift: (Math.random() - .5) * .16,
      phase: Math.random() * Math.PI * 2,
      opacity: .2 + Math.random() * .55
    });
    const resize = () => {
      const bounds = hero.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const target = Math.min(72, Math.max(28, Math.round(width / 24)));
      while (spores.length < target) spores.push(seedSpore());
      spores.length = target;
    };
    const draw = () => {
      context.clearRect(0, 0, width, height);
      spores.forEach(spore => {
        spore.y -= spore.speed;
        spore.x += spore.drift + Math.sin(spore.phase + frame * .008) * .06;
        if (spore.y < -8 || spore.x < -12 || spore.x > width + 12) {
          seedSpore(spore);
          spore.y = height + 8;
        }
        context.beginPath();
        context.fillStyle = `rgba(222,235,196,${spore.opacity})`;
        context.arc(spore.x, spore.y, spore.radius, 0, Math.PI * 2);
        context.fill();
      });
      frame += 1;
      if (!reducedMotion) requestAnimationFrame(draw);
    };
    resize();
    draw();
    addEventListener("resize", resize, { passive: true });
    if (!reducedMotion) hero.addEventListener("pointermove", event => {
      const bounds = hero.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width - .5) * -18;
      const y = ((event.clientY - bounds.top) / bounds.height - .5) * -12;
      hero.style.setProperty("--world-x", `${x}px`);
      hero.style.setProperty("--world-y", `${y}px`);
    }, { passive: true });
  }
})();
