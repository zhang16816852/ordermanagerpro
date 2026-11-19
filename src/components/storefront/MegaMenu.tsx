import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";

export type MegaMenuItem = {
  id: string;
  name: string;
  count?: number;
  href?: string;
  children?: MegaMenuItem[];
};

export type MegaMenuProps = {
  label: string;
  items: MegaMenuItem[];
  columns?: number;
  width?: string;
  footerHref?: string;
  footerLabel?: string;
};

export function MegaMenu({
  label,
  items,
  columns = 3,
  width = "w-[min(90vw,720px)]",
  footerHref = "/shop",
  footerLabel = "查看全部商品 →",
}: MegaMenuProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  const gridCols =
    columns === 2 ? "grid-cols-2" : columns === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3";

  return (
    <div className="relative" onMouseEnter={() => { cancelClose(); setOpen(true); }} onMouseLeave={scheduleClose}>
      <button
        type="button"
        className="flex items-center gap-1 text-[0.9375rem] text-sf-text transition-colors hover:text-sf-muted"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && items.length > 0 && (
        <div
          className={`absolute left-0 top-full z-50 mt-2 ${width} rounded-lg border border-[color:var(--sf-line)] bg-sf-surface p-6 shadow-xl`}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className={`grid gap-6 ${gridCols}`}>
            {items.map((root) => (
              <div key={root.id}>
                <span className="block text-sm font-medium text-sf-text">
                  {root.name}
                  {root.count != null && <span className="ml-1 text-xs opacity-60">({root.count})</span>}
                </span>
                {root.children && root.children.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {root.children.map((child) => (
                      <li key={child.id}>
                        <Link
                          to={child.href || `/shop`}
                          className="block text-xs text-sf-muted hover:text-sf-text transition-colors"
                          onClick={() => setOpen(false)}
                        >
                          {child.name}
                          {child.count != null && <span className="ml-1 opacity-60">({child.count})</span>}
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
              to={footerHref}
              className="text-sm text-sf-muted hover:text-sf-text"
              onClick={() => setOpen(false)}
            >
              {footerLabel}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
