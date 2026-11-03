/** Keep a native select as state, and render one consistent keyboard-accessible menu. */
export function enhanceSelect(select: HTMLSelectElement) {
  select.hidden = true;
  const details = document.createElement("details");
  details.className = "choice-menu";
  const summary = document.createElement("summary");
  const name =
    select.getAttribute("aria-label") ||
    select.labels?.[0]?.textContent?.trim() ||
    "선택";
  summary.setAttribute("aria-label", name);
  const text = document.createElement("span");
  summary.append(text);
  const menu = document.createElement("div");
  menu.className = "choice-options";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", name);
  details.append(summary, menu);
  select.after(details);
  function update() {
    summary.setAttribute("aria-disabled", String(select.disabled));
    text.textContent = select.selectedOptions[0]?.textContent || "선택";
    menu.replaceChildren();
    Array.from(select.options).forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option.textContent;
      button.disabled = option.disabled || select.disabled;
      button.setAttribute("aria-pressed", String(option.selected));
      button.addEventListener("click", () => {
        if (select.disabled) return;
        select.value = option.value;
        details.open = false;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        update();
        summary.focus();
      });
      menu.append(button);
    });
  }
  select.addEventListener("change", update);
  select.addEventListener("optionschange", update);
  summary.addEventListener("click", (event) => {
    if (select.disabled) event.preventDefault();
  });
  summary.addEventListener("keydown", (event) => {
    if (select.disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      details.open = true;
      menu.querySelector("button")?.focus();
    }
  });
  details.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      details.open = false;
      summary.focus();
    }
    const buttons = Array.from(
      menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (
      current >= 0 &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      buttons[
        (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length
      ]?.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!details.contains(event.target as Node)) details.open = false;
  });
  update();
  return { update };
}
