import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { usePublicCategoryTree, type PublicCategoryNode } from "@/storefront/usePublicCatalog";
import { ChevronDown } from "lucide-react";

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

export function CategoryMegaMenu({ onNavigate }: { onNavigate?: () => void }) {
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
        className="flex items-center gap-1 text-[0.9375rem] text-sf-text transition-colors hover:text-sf-muted"
        onClick={() => setOpen((v) => !v)}
      >
        商品分類
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && tree.length > 0 && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(90vw,720px)] rounded-lg border border-[color:var(--sf-line)] bg-sf-surface p-6 shadow-xl"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
            {tree.map((root) => (
              <div key={root.id}>
                <Link
                  to={`/shop?cat=${root.id}`}
                  className="block text-sm font-medium text-sf-text hover:underline"
                  onClick={() => { setOpen(false); onNavigate?.(); }}
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
                          onClick={() => { setOpen(false); onNavigate?.(); }}
                        >
                          {child.name}
                        </Link>
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
              onClick={() => { setOpen(false); onNavigate?.(); }}
            >
              查看全部商品 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
