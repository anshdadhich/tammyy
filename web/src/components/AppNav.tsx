"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Menu, Moon, Sun, X } from "lucide-react";
import { toggleTheme } from "@/lib/theme";
import {
  SESSION_EVENT,
  fetchViewer,
  signOut as endSession,
  recallViewer,
  viewerInitials,
  type ViewerSession,
} from "@/lib/session-client";

const LANDING_NAV = [
  { label: "Candidates", href: "/#candidates" },
  { label: "Employers", href: "/hire" },
  { label: "Match engine", href: "/#engine" },
  { label: "FAQ", href: "/#faq" },
] as const;

const JOIN_NAV = [
  { label: "Home", href: "/" },
  { label: "Build my page", href: "/join" },
] as const;

const HIRE_NAV = [
  { label: "Home", href: "/" },
  { label: "Hiring", href: "/hire" },
] as const;

const SIGNUP_OPTIONS = [
  { label: "Get hired", href: "/join" },
  { label: "Hiring someone", href: "/hire/login" },
] as const;

type NavItem = { label: string; href: string };

function sameViewer(a: ViewerSession | null | undefined, b: ViewerSession | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind || a.email !== b.email) return false;
  return (a.isAdmin ?? false) === (b.isAdmin ?? false);
}

export default function AppNav({ active: activeProp, initialViewer = null, viewerConfirmed = true }: { active?: string; initialViewer?: ViewerSession | null; viewerConfirmed?: boolean } = {}) {
  const pathname = usePathname();
  const isJoin = pathname.startsWith("/join");
  const isHire = pathname.startsWith("/hire");
  const isAuthPage = pathname.startsWith("/hire/login") || pathname.startsWith("/join");
  const items: readonly NavItem[] = isJoin ? JOIN_NAV : isHire ? HIRE_NAV : LANDING_NAV;
  const sectionActive = isJoin ? "/join" : isHire ? "/hire" : null;
  const showAuth = !isJoin;

  const [landingActive, setLandingActive] = useState<string>(
    activeProp ?? LANDING_NAV[0]?.href ?? "/",
  );
  const active = sectionActive ?? landingActive;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [viewer, setViewer] = useState<ViewerSession | null>(initialViewer);
  const [syncedInitialViewer, setSyncedInitialViewer] = useState(initialViewer);
  const [provisional, setProvisional] = useState(!initialViewer && !viewerConfirmed);
  const [scrolled, setScrolled] = useState(false);
  const [hideNav, setHideNav] = useState(false);
  const reduceMotion = useReducedMotion();
  const actionsRef = useRef<HTMLDivElement>(null);

  const lastY = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 8);
      if (y > 140 && y > lastY.current + 2) setHideNav(true);
      else if (y < lastY.current - 2) setHideNav(false);
      lastY.current = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash;
      if (hash && LANDING_NAV.some((n) => n.href === `/${hash}`)) {
        setLandingActive(`/${hash}`);
        return;
      }
      if (!hash) setLandingActive(activeProp ?? LANDING_NAV[0]?.href ?? "/");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [activeProp]);

  // Apply new server-rendered identity during render, before React paints the
  // old actions for a route transition. Compares by value so equal identities
  // never tear down the actions subtree; an unconfirmed null never replaces a
  // known viewer (server hiccup must not paint logged-out UI).
  if (!sameViewer(initialViewer, syncedInitialViewer)) {
    setSyncedInitialViewer(initialViewer);
    if (initialViewer !== null || viewerConfirmed) setViewer(initialViewer);
  }

  useLayoutEffect(() => {
    const remembered = recallViewer();
    if (remembered) {
      // Hydrate the remembered session synchronously before first paint so a
      // returning user never sees a logged-out flash. External-store read on
      // mount by design — async deferral would reintroduce the flash.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewer((cur) => cur ?? remembered);
      setProvisional(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchViewer()
        .then((v) => {
          if (!alive) return;
          setViewer(v);
          setProvisional(false);
        })
        .catch(() => {
          // Network/5xx: keep the optimistic state instead of painting
          // logged-out UI over a signed-in user (or vice versa).
        });
    };
    load();
    const onEvent = () => load();
    window.addEventListener(SESSION_EVENT, onEvent);
    return () => {
      alive = false;
      window.removeEventListener(SESSION_EVENT, onEvent);
    };
  }, []);

  useEffect(() => {
    if (!authOpen && !profileOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setAuthOpen(false);
        setProfileOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAuthOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [authOpen, profileOpen]);

  const signOut = async () => {
    await endSession();
    setViewer(null);
    setProvisional(false);
    setProfileOpen(false);
    setMobileOpen(false);
  };

  return (
    <motion.header
      className={`site-navbar-wrap${scrolled && !isAuthPage ? " is-scrolled" : ""}`}
      initial={false}
      animate={{ y: hideNav ? "-110%" : 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="site-navbar !px-[max(24px,calc((100%_-_1160px)/2))]">
        <Link
          href="/"
          className="site-brand site-brand-text"
          onClick={() => {
            setLandingActive(LANDING_NAV[0]?.href ?? "/");
            setMobileOpen(false);
          }}
        >
          Tammy
        </Link>

        <nav aria-label="Main navigation" className="site-navigation hidden lg:flex">
          <div className="site-nav-links">
            {items.map((item) => {
              const isActive = active === item.href;
              return (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  onClick={() => {
                    setLandingActive(item.href);
                    setMobileOpen(false);
                  }}
                  aria-current={isActive ? "page" : undefined}
                  className={`site-nav-link press${isActive ? " is-active" : ""}`}
                  style={{ position: "relative" }}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="site-nav-pill"
                      className="site-nav-pill"
                      initial={false}
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  ) : null}
                  <span style={{ position: "relative" }}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="site-nav-actions" ref={actionsRef}>
          {viewer ? (
            <div className="nav-menu-wrap">
              <button
                type="button"
                className="nav-avatar press"
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                aria-label="Account menu"
                onClick={() => {
                  setProfileOpen((v) => !v);
                  setAuthOpen(false);
                }}
              >
                {viewerInitials(viewer)}
              </button>
              {profileOpen ? (
                <div className="nav-menu" role="menu">
                  <Link
                    href="/settings"
                    role="menuitem"
                    className="nav-menu-item"
                    onClick={() => setProfileOpen(false)}
                  >
                    Settings
                  </Link>
                  {viewer.isAdmin ? (
                    <Link
                      href="/admin"
                      role="menuitem"
                      className="nav-menu-item"
                      onClick={() => setProfileOpen(false)}
                    >
                      Admin
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    className="nav-menu-item"
                    onClick={() => void signOut()}
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {viewer?.kind === "hr" ? (
            <Link
              href="/hire/search"
              className="site-login press h-10"
              onClick={() => setMobileOpen(false)}
            >
              Search
            </Link>
          ) : null}
          <button
            type="button"
            className="theme-toggle press"
            aria-label="Toggle color theme"
            title="Toggle light / dark theme"
            onClick={toggleTheme}
          >
            <Sun className="theme-icon-sun" aria-hidden="true" />
            <Moon className="theme-icon-moon" aria-hidden="true" />
          </button>
          {showAuth && !viewer ? (
            provisional ? (
              <span className="nav-avatar nav-avatar--ghost" aria-hidden="true" />
            ) : (
              <div className="nav-menu-wrap">
              <button
                type="button"
                className="site-nav-cta press h-10"
                aria-haspopup="menu"
                aria-expanded={authOpen}
                onClick={() => {
                  setAuthOpen((v) => !v);
                  setProfileOpen(false);
                }}
              >
                Login / Sign up
              </button>
              {authOpen ? (
                <div className="nav-menu" role="menu">
                  {SIGNUP_OPTIONS.map((option) => (
                    <Link
                      key={option.href}
                      href={option.href}
                      role="menuitem"
                      className="nav-menu-item"
                      onClick={() => {
                        setAuthOpen(false);
                        setMobileOpen(false);
                      }}
                    >
                      {option.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            )
          ) : null}
          <button
            type="button"
            className="site-nav-burger lg:hidden press"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {mobileOpen ? (
          <motion.nav
            key="mobile-nav"
            aria-label="Mobile navigation"
            className="site-mobile-nav lg:hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }
            }
            style={{ overflow: "hidden" }}
          >
            <div className="site-mobile-links">
              {items.map((item, i) => (
                <motion.div
                  key={item.href + item.label}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.25,
                    delay: reduceMotion ? 0 : 0.05 + i * 0.05,
                  }}
                >
                  <Link
                    href={item.href}
                    onClick={() => {
                      setLandingActive(item.href);
                      setMobileOpen(false);
                    }}
                    className={`site-mobile-link${active === item.href ? " is-active" : ""}`}
                  >
                    {item.label}
                  </Link>
                </motion.div>
              ))}
              {showAuth ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.25,
                    delay: reduceMotion ? 0 : 0.28,
                  }}
                  className="site-mobile-actions"
                >
                  {!viewer ? (
                    provisional ? (
                      <span className="nav-avatar nav-avatar--ghost" aria-hidden="true" />
                    ) : (
                      <button
                        type="button"
                        className="site-nav-cta"
                        style={{ justifyContent: "center" }}
                        aria-expanded={authOpen}
                        onClick={() => setAuthOpen((v) => !v)}
                      >
                        Login / Sign up
                      </button>
                    )
                  ) : null}
                  {!viewer && authOpen ? (
                    <div className="nav-menu nav-menu--inline" role="menu">
                      {SIGNUP_OPTIONS.map((option) => (
                        <Link
                          key={option.href}
                          href={option.href}
                          role="menuitem"
                          className="nav-menu-item"
                          onClick={() => {
                            setAuthOpen(false);
                            setMobileOpen(false);
                          }}
                        >
                          {option.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  {viewer?.kind === "hr" ? (
                    <Link
                      href="/hire/search"
                      className="site-login"
                      style={{ justifyContent: "center" }}
                      onClick={() => setMobileOpen(false)}
                    >
                      Search
                    </Link>
                  ) : null}
                  {viewer ? (
                    <>
                      <Link
                        href="/settings"
                        className="site-login"
                        style={{ justifyContent: "center" }}
                        onClick={() => setMobileOpen(false)}
                      >
                        Settings
                      </Link>
                      <button
                        type="button"
                        className="site-login"
                        style={{ justifyContent: "center" }}
                        onClick={() => void signOut()}
                      >
                        Log out
                      </button>
                    </>
                  ) : null}
                </motion.div>
              ) : null}
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </motion.header>
  );
}
