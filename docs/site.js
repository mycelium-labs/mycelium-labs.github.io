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
})();
