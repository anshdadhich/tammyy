"use client";

import { useEffect, useRef } from "react";

/**
 * Score/pipeline bar that animates its width from 0 to `width` the first
 * time it scrolls into view (120ms after the observer fires, so multiple
 * bars in one row grow together instead of staggering).
 */
export default function TraceFill({
  width,
  background = "var(--brand)",
}: {
  width: string;
  background?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reveal = () => {
      window.setTimeout(() => {
        el.style.width = width;
      }, 120);
    };
    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      el.style.width = width;
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          reveal();
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -70px 0px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [width]);

  return <div ref={ref} className="trace-fill" style={{ background }} />;
}
