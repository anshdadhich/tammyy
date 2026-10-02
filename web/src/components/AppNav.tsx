"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ViewerSession } from "@/lib/hr-session";
import { toggleTheme } from "@/lib/theme";

type Variant = "landing" | "join" | "hire";

const NAV_ITEMS: Record<Variant, { label: string; href: string }[]> = {
  landing: [
    { label: "Candidates", href: "/#candidates" },
    { label: "Employers", href: "/hire" },
    { label: "Match engine", href: "/#engine" },
    { label: "FAQ", href: "/#faq" },
  ],
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
  const [menu, setMenu] = useState<"" | "auth" | "account">("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      headerRef.current?.classList.toggle("is-scrolled", y > 8);
      headerRef.current?.classList.toggle("is-hidden", y > 140 && y > lastY + 2);
      if (y < lastY - 2) headerRef.current?.classList.remove("is-hidden");
      lastY = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);


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

  const items = NAV_ITEMS[variant];
  const linksRef = useRef<HTMLDivElement>(null);
  const pillReadyRef = useRef(false);
  useEffect(() => {
    const container = linksRef.current;
    const pill = container?.querySelector<HTMLElement>(".site-nav-pill");
    if (!container || !pill) return;
    const move = () => {
      const target = container.querySelector<HTMLElement>(
        `[data-nav-item="${CSS.escape(active ?? "")}"]`,
      );
      if (!target) {
        pill.style.opacity = "0";
        pill.style.width = "0px";
        return;
      }
      pill.style.opacity = "1";
      pill.style.width = `${target.offsetWidth}px`;
      pill.style.transform = `translateX(${target.offsetLeft}px)`;
      if (!pillReadyRef.current) {
        // First placement snaps without a glide-from-zero; every later
        // move animates via the CSS transition.
        pill.style.transition = "none";
        pill.getBoundingClientRect();
        pill.style.transition = "";
        pillReadyRef.current = true;
      }
    };
    move();
    const ro = new ResizeObserver(move);
    ro.observe(container);
    // Web fonts change link widths after first paint — re-measure when ready.
    document.fonts?.ready.then(() => move()).catch(() => {});
    return () => ro.disconnect();
  }, [active, items]);

  const showLogin = !viewer && variant !== "join";
  const showSearch = viewer !== null && viewer.kind === "hr" && !viewer.isAdmin;

  const closeAll = () => {
    setMenu("");
    setMobileOpen(false);
  };

  const logout = async () => {
    closeAll();
    await fetch("/api/auth/logout", { method: "POST" });
    router.refresh();
  };

  const linkItems = items.map((it) => {
    const isActive = active === it.href;
    return (
      <Link
        key={it.href}
        href={it.href}
        data-nav-item={it.href}
        className={`site-nav-link press${isActive ? " is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
        onClick={closeAll}
      >
        {it.label}
      </Link>
    );
  });

  const mobileItems = items.map((it) => {
    const isActive = active === it.href;
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
          <div className="site-nav-links" ref={linksRef}>
            <span className="site-nav-pill" aria-hidden="true" />
            {linkItems}
          </div>
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
