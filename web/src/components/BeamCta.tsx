"use client";

import { useEffect, useState, type ReactNode } from "react";
import BorderBeam from "border-beam";

/**
 * CTA wrapper with the traveling border beam. Theme follows the app's
 * data-theme toggle (not the OS preference) so the beam matches the page
 * the visitor actually chose.
 */
export default function BeamCta({
  children,
  borderRadius = 999,
}: {
  children: ReactNode;
  borderRadius?: number;
}) {
  const [theme, setTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  return (
    <BorderBeam
      size="sm"
      colorVariant="mono"
      strength={0.7}
      borderRadius={borderRadius}
      theme={theme}
    >
      {children}
    </BorderBeam>
  );
}
