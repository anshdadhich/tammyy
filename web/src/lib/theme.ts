type ViewTransitionDoc = Document & {
  startViewTransition?: (updateCallback: () => void) => { finished: Promise<void> };
};

export function applyTheme(next: "light" | "dark") {
  const root = document.documentElement;
  const apply = () => {
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("tammy_theme", next);
    } catch {
    }
  };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const start = (document as ViewTransitionDoc).startViewTransition;
  if (!reduce && typeof start === "function") {
    start.call(document, apply);
    return;
  }
  apply();
  if (!reduce) {
    // Soft cross-fade on runtimes without the View Transitions API.
    document.body.classList.add("theme-flipping");
    window.setTimeout(() => document.body.classList.remove("theme-flipping"), 260);
  }
}

export function toggleTheme() {
  const next =
    document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
}
