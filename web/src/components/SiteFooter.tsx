import Link from "next/link";
import DitherCanvas from "@/components/DitherCanvas";

export default function SiteFooter() {
  return (
    <footer id="start" className="footer-simple">
      <div className="footer-simple-shell">
        <div className="footer-simple-frame">
          <div className="footer-simple-blue">
            <div className="footer-simple-dither" aria-hidden="true">
              <DitherCanvas />
            </div>
            <div className="footer-simple-card">
              <div className="footer-simple-grid">
                <div className="footer-simple-brandblock">
                  <Link href="/#top" className="footer-simple-logo">
                    Tammy
                  </Link>
                  <div className="footer-simple-visit">
                    <span className="footer-simple-pill">Start here</span>
                    <Link href="/join" className="footer-simple-cta press">
                      Build my page
                    </Link>
                    <a href="mailto:hiya@tammy.sh" className="footer-simple-mail">
                      hiya@tammy.sh
                    </a>
                  </div>
                </div>
                <nav className="footer-simple-col" aria-label="Talent">
                  <p className="footer-simple-h">Talent</p>
                  <Link href="/#candidates">Candidates</Link>
                  <Link href="/#engine">How it works</Link>
                  <Link href="/#faq">FAQ</Link>
                </nav>
                <nav className="footer-simple-col" aria-label="Hiring">
                  <p className="footer-simple-h">Hiring</p>
                  <Link href="/hire">Employers</Link>
                  <Link href="/hire/search">Search</Link>
                  <Link href="/hire/login">Employer login</Link>
                  <Link href="/join">For candidates</Link>
                </nav>
              </div>
            </div>
          </div>
        </div>
        <div className="footer-simple-bottom">
          <span>© 2026 Tammy Technologies Inc.</span>
          <nav aria-label="Legal">
            <a href="mailto:hiya@tammy.sh?subject=Privacy">Privacy</a>
            <a href="mailto:hiya@tammy.sh?subject=Terms">Terms</a>
            <a href="mailto:hiya@tammy.sh?subject=Security">Security</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
