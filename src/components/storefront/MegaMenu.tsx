import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

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
  width?: string;
  footerHref?: string;
  footerLabel?: string;
};

export function MegaMenu({
  label,
  items,
  width = "w-[560px]",
  footerHref = "/shop",
  footerLabel = "查看全部商品 →",
}: MegaMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const closeTimer = useRef<number | null>(null);

  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  const activeItem = items.find((it) => it.id === activeId) ?? items[0];

  return (
    <div
      className="relative"
      onMouseEnter={() => { cancelClose(); setOpen(true); if (!activeId && items.length) setActiveId(items[0].id); }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="flex items-center gap-1 text-[0.9375rem] text-sf-text transition-colors hover:text-sf-muted"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && items.length > 0 && (
        <div
          className={`absolute left-0 top-full z-50 mt-2 ${width} rounded-lg border border-[color:var(--sf-line)] bg-sf-surface shadow-xl overflow-hidden`}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="flex min-h-[280px]">
            {/* First level: brand/category list */}
            <div className="w-44 shrink-0 border-r border-[color:var(--sf-line)] bg-sf-paper/50 p-2">
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveId(item.id)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors text-left",
                        activeId === item.id
                          ? "bg-sf-surface text-sf-text font-medium"
                          : "text-sf-muted hover:bg-sf-surface/60 hover:text-sf-text",
                      )}
                    >
                      <span className="truncate">
                        {item.name}
                        {item.count != null && <span className="ml-1 text-xs opacity-60">({item.count})</span>}
                      </span>
                      {item.children && item.children.length > 0 && (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Second level: sliding panel */}
            <div className="flex-1 p-4 overflow-y-auto max-h-[360px]">
              {activeItem?.children && activeItem.children.length > 0 ? (
                <>
                  <p className="mb-2 text-xs font-medium text-sf-muted">{activeItem.name}</p>
                  <ul className="grid grid-cols-2 gap-1">
                    {activeItem.children.map((child) => (
                      <li key={child.id}>
                        <Link
                          to={child.href || "/shop"}
                          className="block rounded-sm px-2 py-1.5 text-sm text-sf-text transition-colors hover:bg-sf-paper hover:text-sf-accent"
                          onClick={() => setOpen(false)}
                        >
                          {child.name}
                          {child.count != null && <span className="ml-1 text-xs text-sf-muted">({child.count})</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-sf-muted">
                  {activeItem?.name}
                  {activeItem?.count != null && <span className="ml-1">({activeItem.count} 項)</span>}
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-[color:var(--sf-line)] px-4 py-2">
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


