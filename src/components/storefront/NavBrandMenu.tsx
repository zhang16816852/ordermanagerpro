import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { usePublicBrands, usePublicBrandSeries } from "@/storefront/usePublicCatalog";
import { ChevronDown } from "lucide-react";

export function NavBrandMenu() {
  const { data: brands } = usePublicBrands();
  const { data: series } = usePublicBrandSeries();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const seriesByBrand: Record<string, any[]> = {};
  (series ?? []).forEach((s: any) => {
    if (!seriesByBrand[s.brand_id]) seriesByBrand[s.brand_id] = [];
    seriesByBrand[s.brand_id].push(s);
  });

  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  return (
    <div className="relative" onMouseEnter={() => { cancelClose(); setOpen(true); }} onMouseLeave={scheduleClose}>
      <button type="button" className="flex items-center gap-1 text-[0.9375rem] text-sf-text transition-colors hover:text-sf-muted" onClick={() => setOpen((v) => !v)}>
        品牌 / 系列
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && (brands ?? []).length > 0 && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(90vw,520px)] rounded-lg border border-[color:var(--sf-line)] bg-sf-surface p-6 shadow-xl"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {(brands ?? []).map((b: any) => {
              const ss = seriesByBrand[b.id] ?? [];
              return (
                <div key={b.id}>
                  <Link
                    to={`/shop?brand=${b.id}`}
                    className="block text-sm font-medium text-sf-text hover:underline"
                    onClick={() => setOpen(false)}
                  >
                    {b.name}
                  </Link>
                  {ss.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {ss.map((s: any) => (
                        <li key={s.series_id}>
                          <Link
                            to={`/shop?brand=${b.id}&series=${s.series_id}`}
                            className="block text-xs text-sf-muted hover:text-sf-text"
                            onClick={() => setOpen(false)}
                          >
                            {s.series_name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 border-t border-[color:var(--sf-line)] pt-3">
            <Link to="/shop" className="text-sm text-sf-muted hover:text-sf-text" onClick={() => setOpen(false)}>
              查看全部商品 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
