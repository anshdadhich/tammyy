import AppNav from "@/components/AppNav";
import SiteFooter from "@/components/SiteFooter";
import { readNavViewer, type ViewerSession } from "@/lib/hr-session";

type Props = {
  children: React.ReactNode;
  variant?: "landing" | "join" | "hire";
  active?: string;
  footer?: boolean;
  viewer?: ViewerSession | null;
};

export default async function PageShell({ children, variant = "landing", active, footer, viewer }: Props) {
  const nav = viewer !== undefined ? viewer : await readNavViewer();
  return (
    <div className="relative min-h-screen bg-paper text-body antialiased selection:bg-brand selection:text-on-brand">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <AppNav variant={variant} active={active} viewer={nav} />
      <main id="main-content">{children}</main>
      {footer && <SiteFooter />}
    </div>
  );
}
