(() => {
  const copyText = async (value) => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  };

  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const state = button.querySelector("[data-copy-state]");
      try {
        await copyText(button.dataset.copy);
        if (state) state.textContent = "Copied";
      } catch (_) {
        if (state) state.textContent = "Select command";
      }
      window.setTimeout(() => { if (state) state.textContent = "Copy"; }, 1600);
    });
  });

  const tabs = [...document.querySelectorAll("[data-receipt-tab]")];
  const panels = [...document.querySelectorAll("[data-receipt-panel]")];
  const status = document.querySelector("[data-receipt-status]");
  const selectTab = (tab, announce = true) => {
    const key = tab.dataset.receiptTab;
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.receiptPanel !== key; });
    if (announce && status) status.textContent = `${tab.textContent.trim()} evidence selected`;
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[next].focus();
      selectTab(tabs[next]);
    });
  });

  const trace = document.querySelector("[data-trace-exhibit]");
  const replay = document.querySelector("[data-replay]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const play = () => {
    if (!trace || reducedMotion) return;
    trace.classList.remove("is-playing");
    requestAnimationFrame(() => requestAnimationFrame(() => trace.classList.add("is-playing")));
  };
  replay?.addEventListener("click", play);
  play();
})();
