(() => {
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
