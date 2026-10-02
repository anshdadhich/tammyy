"use client";

import { useEffect } from "react";

/**
 * One observer for every `[data-reveal-section]` on the page: sections rise
 * into view as they scroll. No-op under prefers-reduced-motion.
 */
export default function SectionReveals() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal-section]"));
    if (!nodes.length) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      for (const n of nodes) n.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 },
    );
    for (const n of nodes) io.observe(n);
    return () => io.disconnect();
  }, []);
  return null;
}
