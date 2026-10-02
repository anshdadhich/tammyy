"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ViewerSession } from "@/lib/hr-session";
import { toggleTheme } from "@/lib/theme";

type Variant = "landing" | "join" | "hire";
type NavItem = { label: string; href: string };

/** Same nav for every page while logged out. */
const PUBLIC_NAV: NavItem[] = [
  { label: "Candidates", href: "/#candidates" },
  { label: "Employers", href: "/hire" },
  { label: "Match engine", href: "/#engine" },
  { label: "FAQ", href: "/#faq" },
];

const NAV_ITEMS: Record<Variant, NavItem[]> = {
  landing: PUBLIC_NAV,
  join: [
    { label: "Home", href: "/" },
    { label: "Build my page", href: "/join" },
  ],
  hire: [
    { label: "Home", href: "/" },
    { label: "Hiring", href: "/hire" },
  ],
};

const SUN_PATHS = (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </>
);

function initialsOf(v: ViewerSession) {
  const src = (v.name ?? v.email.split("@")[0]).trim();
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const out = parts.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return out || "?";
}

export default function AppNav({
  variant,
  active,
  viewer,
}: {
  variant: Variant;
  active?: string;
  viewer: ViewerSession | null;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [menu, setMenu] = useState<"" | "auth" | "account">("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [spyActive, setSpyActive] = useState<string | null>(null);

  // Scroll-spy for pages with landing sections (Candidates/Match engine/FAQ):
  // the pill follows whichever section is under the reading line. Pages
  // without those sections keep the static `active` prop.
  useEffect(() => {
    const sections = (["candidates", "engine", "faq"] as const)
      .map((id) => ({ href: `/#${id}`, el: document.getElementById(id) }))
      .filter((s): s is { href: string; el: HTMLElement } => s.el !== null);
    if (!sections.length) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = window.scrollY + 140;
      // First section is the default, so the hero region keeps the pill on
      // Candidates (matching the SSR pin) and it only moves from there.
      let current: string = sections[0].href;
      for (const s of sections) {
        if (s.el.offsetTop <= line) current = s.href;
      }
      setSpyActive(current);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const effectiveActive = spyActive ?? active;

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      headerRef.current?.classList.toggle("is-scrolled", y > 8);
      if (!mobileOpen) {
        headerRef.current?.classList.toggle("is-hidden", y > 140 && y > lastY + 2);
        if (y < lastY - 2) headerRef.current?.classList.remove("is-hidden");
      } else {
        headerRef.current?.classList.remove("is-hidden");
      }
      lastY = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mobileOpen]);


  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu("");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu("");
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const items = viewer ? NAV_ITEMS[variant] : PUBLIC_NAV;

  const showLogin = !viewer;
  const showSearch = viewer !== null && viewer.kind === "hr" && !viewer.isAdmin;

  const closeAll = () => {
    setMenu("");
    setMobileOpen(false);
  };

  const [loggingOut, setLoggingOut] = useState(false);
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    closeAll();
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  const linkItems = items.map((it) => {
    const isActive = effectiveActive === it.href;
    return (
      <Link
        key={it.href}
        href={it.href}
        className={`site-nav-link press${isActive ? " is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
        onClick={closeAll}
      >
        {isActive ? (
          <motion.span
            layoutId="site-nav-pill"
            className="site-nav-pill"
            initial={false}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 35 }}
            aria-hidden="true"
          />
        ) : null}
        <span style={{ position: "relative" }}>{it.label}</span>
      </Link>
    );
  });

  const mobileItems = items.map((it) => {
    const isActive = effectiveActive === it.href;
    return (
      <Link
        key={it.href}
        href={it.href}
        className={`site-mobile-link${isActive ? " is-active" : ""}`}
        onClick={closeAll}
      >
        {it.label}
      </Link>
    );
  });

  return (
    <header ref={headerRef} className="site-navbar-wrap">
      <div className="site-navbar !px-[max(24px,calc((100%_-_1160px)/2))]">
        <Link href="/" className="site-brand site-brand-text">
          Tammy
        </Link>
        <nav aria-label="Main navigation" className="site-navigation hidden lg:flex">
          <div className="site-nav-links">{linkItems}</div>
        </nav>
        <div className="site-nav-actions">
          {viewer && (
            <div className="nav-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="nav-avatar press"
                aria-haspopup="menu"
                aria-expanded={menu === "account"}
                aria-label="Account menu"
                onClick={() => setMenu(menu === "account" ? "" : "account")}
              >
                {initialsOf(viewer)}
              </button>
              {menu === "account" && (
                <div className="nav-menu" role="menu">
                  <div className="nav-menu-item" style={{ cursor: "default" }}>
                    {viewer.email}
                  </div>
                  <Link href="/settings" className="nav-menu-item" role="menuitem" onClick={closeAll}>
                    Settings
                  </Link>
                  {viewer.isAdmin && (
                    <Link href="/admin" className="nav-menu-item" role="menuitem" onClick={closeAll}>
                      Admin console
                    </Link>
                  )}
                  <button type="button" className="nav-menu-item" role="menuitem" onClick={logout}>
                    Log out
                  </button>
                </div>
              )}
            </div>
          )}
          {showSearch && (
            <Link href="/hire/search" className="site-login press h-10" onClick={closeAll}>
              Search
            </Link>
          )}
          <button
            type="button"
            className="theme-toggle press"
            aria-label="Toggle color theme"
            title="Toggle light / dark theme"
            onClick={toggleTheme}
          >
            <svg
              className="theme-icon-sun"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {SUN_PATHS}
            </svg>
            <svg
              className="theme-icon-moon"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          </button>
          {showLogin && (
            <div className="nav-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="site-nav-cta press h-10"
                aria-haspopup="menu"
                aria-expanded={menu === "auth"}
                onClick={() => setMenu(menu === "auth" ? "" : "auth")}
              >
                Login / Sign up
              </button>
              {menu === "auth" && (
                <div className="nav-menu" role="menu">
                  <Link href="/join" className="nav-menu-item" role="menuitem" onClick={closeAll}>
                    Get hired
                  </Link>
                  <Link href="/hire/login" className="nav-menu-item" role="menuitem" onClick={closeAll}>
                    Hiring someone
                  </Link>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="site-nav-burger lg:hidden press"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => {
              setMenu("");
              setMobileOpen(!mobileOpen);
            }}
          >
            {mobileOpen ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="4" x2="20" y1="12" y2="12" />
                <line x1="4" x2="20" y1="6" y2="6" />
                <line x1="4" x2="20" y1="18" y2="18" />
              </svg>
            )}
          </button>
        </div>
        {mobileOpen && (
          <div className="site-mobile-nav">
            <div className="site-mobile-links">{mobileItems}</div>
            <div className="site-mobile-actions">
              {showLogin && (
                <>
                  <Link href="/join" className="site-nav-cta press" onClick={closeAll}>
                    Get hired
                  </Link>
                  <Link href="/hire/login" className="site-login press" onClick={closeAll}>
                    Hiring someone
                  </Link>
                </>
              )}
              {showSearch && (
                <Link href="/hire/search" className="site-login press" onClick={closeAll}>
                  Search
                </Link>
              )}
              {viewer && (
                <>
                  <Link href="/settings" className="site-login press" onClick={closeAll}>
                    Settings
                  </Link>
                  <button type="button" className="site-login press" onClick={logout}>
                    Log out
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
