import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePublicCategoryTree, type PublicCategoryNode } from "@/storefront/usePublicCatalog";
import Lenis from "lenis";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { siteBrand } from "@/config/site";

/**
 * 公開店面外框（首頁 + 未來 /shop）
 * ------------------------------------------------------------
 * 三件重點：
 * 1. 只在公開路由使用；內部 AppLayout 與本元件完全無關，ERP 版面不受影響。
 * 2. Lenis 平滑捲動僅在此啟用，且尊重 prefers-reduced-motion
 *    （CSS 的 html { scroll-behavior } 仍由各路由自行決定）。
 * 3. header 內登入態顯示「工作台」捷徑；未登入顯示「登入」。
 */

function useLenis() {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const lenis = new Lenis({ duration: 1.05, smoothWheel: true });

    const raf = (time: number) => {
      lenis.raf(time);
      rafRef.current = requestAnimationFrame(raf);
    };
    rafRef.current = requestAnimationFrame(raf);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lenis.destroy();
    };
  }, []);
}

function buildTree(nodes: PublicCategoryNode[]) {
  const byParent = new Map<string | null, PublicCategoryNode[]>();
  nodes.forEach((n) => {
    const key = n.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  });
  const build = (parentId: string | null): (PublicCategoryNode & { children: any[] })[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
      .map((n) => ({ ...n, children: build(n.id) }));
  return build(null);
}

function CategoryMegaMenu() {
  const { data: catTree } = usePublicCategoryTree();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const tree = buildTree(catTree ?? []);

  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="sf-link-underline text-[0.9375rem]"
        onClick={() => setOpen((v) => !v)}
      >
        商品分類
      </button>
      {open && tree.length > 0 && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(90vw,720px)] rounded-xl border border-[color:var(--sf-line)] bg-sf-paper p-6 shadow-lg"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
            {tree.map((root) => (
              <div key={root.id}>
                <Link
                  to={`/shop?cat=${root.id}`}
                  className="block text-sm font-medium text-sf-text hover:underline"
                  onClick={() => setOpen(false)}
                >
                  {root.name}
                </Link>
                {root.children.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {root.children.map((child: any) => (
                      <li key={child.id}>
                        <Link
                          to={`/shop?cat=${child.id}`}
                          className="block text-sm text-sf-muted hover:text-sf-text"
                          onClick={() => setOpen(false)}
                        >
                          {child.name}
                        </Link>
                        {child.children.length > 0 && (
                          <ul className="ml-3 mt-1 space-y-0.5">
                            {child.children.map((g: any) => (
                              <li key={g.id}>
                                <Link
                                  to={`/shop?cat=${g.id}`}
                                  className="block text-xs text-sf-muted/80 hover:text-sf-text"
                                  onClick={() => setOpen(false)}
                                >
                                  {g.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-[color:var(--sf-line)] pt-3">
            <Link
              to="/shop"
              className="text-sm text-sf-muted hover:text-sf-text"
              onClick={() => setOpen(false)}
            >
              查看全部商品 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkspaceLink() {
  const { user, isAdmin, isRep, isFixEngineer } = useAuth();

  if (!user) {
    return (
      <Link to="/auth" className="sf-link-underline text-[0.9375rem]">
        {siteBrand.signInLabel}
      </Link>
    );
  }

  const href = isFixEngineer ? "/workshop" : isAdmin || isRep ? "/admin" : "/dashboard";

  return (
    <Link to={href} className="sf-link-underline inline-flex items-center gap-1.5 text-[0.9375rem]">
      {siteBrand.workspaceLabel}
      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

export function PublicLayout({ children }: { children: React.ReactNode }) {
  useLenis();
  const [menuOpen, setMenuOpen] = useState(false);

  // 選單開啟時鎖住背景捲動；關閉後恢復（否則 Lenis 仍會吃掉滾動）
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  // "/" 可快速聚焦主內容，略過 header 的多個可點元素
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      document.getElementById("main")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-sf-paper text-sf-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-sf-surface focus:px-4 focus:py-2 focus:text-sm"
      >
        跳至主要內容
      </a>

      <header className="sf-header-blur sticky top-0 z-40 border-b border-[color:var(--sf-line)]">
        <div className="sf-container flex h-16 items-center justify-between gap-6">
          <Link
            to="/"
            className="text-[0.9375rem] font-medium tracking-tight text-sf-text"
            aria-label={`${siteBrand.name} 首頁`}
          >
            {siteBrand.name}
          </Link>

          <nav aria-label="主要" className="hidden items-center gap-8 md:flex">
            <CategoryMegaMenu />
            {siteBrand.nav.map((item) =>
              item.href.startsWith("/") ? (
                <Link key={item.label} to={item.href} className="sf-link-underline text-[0.9375rem]">
                  {item.label}
                </Link>
              ) : (
                <a key={item.label} href={item.href} className="sf-link-underline text-[0.9375rem]">
                  {item.label}
                </a>
              ),
            )}
            <WorkspaceLink />
          </nav>

          <button
            type="button"
            className="md:hidden"
            aria-label={menuOpen ? "關閉選單" : "開啟選單"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div className="fixed inset-x-0 bottom-0 top-16 z-30 overflow-y-auto bg-sf-paper md:hidden">
          <nav aria-label="行動版主要" className="sf-container flex flex-col gap-1 py-8">
            {siteBrand.nav.map((item) =>
              item.href.startsWith("/") ? (
                <Link
                  key={item.label}
                  to={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="border-b border-[color:var(--sf-line)] py-4 text-lg text-sf-text"
                >
                  {item.label}
                </Link>
              ) : (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="border-b border-[color:var(--sf-line)] py-4 text-lg text-sf-text"
                >
                  {item.label}
                </a>
              ),
            )}
            <div className="pt-6">
              <WorkspaceLink />
            </div>
          </nav>
        </div>
      ) : null}

      {children}

      <footer className="border-t border-[color:var(--sf-line)] bg-sf-paper">
        <div className="sf-container py-14">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-[38ch]">
              <p className="text-[0.9375rem] font-medium text-sf-text">{siteBrand.name}</p>
              <p className="sf-eyebrow mt-3">{siteBrand.tagline}</p>
            </div>

            <nav aria-label="頁尾" className="flex flex-col gap-2">
              {siteBrand.nav.map((item) =>
                item.href.startsWith("/") ? (
                  <Link key={item.label} to={item.href} className="sf-link-underline text-sm text-sf-muted">
                    {item.label}
                  </Link>
                ) : (
                  <a key={item.label} href={item.href} className="sf-link-underline text-sm text-sf-muted">
                    {item.label}
                  </a>
                ),
              )}
            </nav>
          </div>

          <div className="sf-rule mt-12 pt-7">
            <p className="sf-eyebrow">
              © {new Date().getFullYear()} {siteBrand.name} ·{" "}
              {siteBrand.tagline}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}