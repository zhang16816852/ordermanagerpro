import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { usePublicDeviceModels } from "@/storefront/usePublicCatalog";
import { ChevronDown } from "lucide-react";

export function NavDeviceModelMenu() {
  const { data: models } = usePublicDeviceModels();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  // group by brand
  const byBrand: Record<string, { id: string; name: string; brand_name: string | null }[]> = {};
  (models ?? []).forEach((m: any) => {
    const key = m.brand_id ?? "__unassigned__";
    if (!byBrand[key]) byBrand[key] = [];
    byBrand[key].push({ id: m.id, name: m.name, brand_name: m.brand_name });
  });

  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  const brandKeys = Object.keys(byBrand).sort((a, b) => {
    if (a === "__unassigned__") return 1;
    if (b === "__unassigned__") return -1;
    const na = byBrand[a][0]?.brand_name || a;
    const nb = byBrand[b][0]?.brand_name || b;
    return na.localeCompare(nb);
  });

  return (
    <div className="relative" onMouseEnter={() => { cancelClose(); setOpen(true); }} onMouseLeave={scheduleClose}>
      <button type="button" className="flex items-center gap-1 text-[0.9375rem] text-sf-text transition-colors hover:text-sf-muted" onClick={() => setOpen((v) => !v)}>
        裝置型號
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && brandKeys.length > 0 && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(90vw,640px)] rounded-lg border border-[color:var(--sf-line)] bg-sf-surface p-6 shadow-xl"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {brandKeys.map((bid) => {
              const ms = byBrand[bid];
              const label = bid === "__unassigned__" ? "其他" : ms[0]?.brand_name || bid;
              return (
                <div key={bid}>
                  <span className="block text-sm font-medium text-sf-text">{label}</span>
                  <ul className="mt-1 space-y-0.5">
                    {ms.map((m) => (
                      <li key={m.id}>
                        <Link
                          to={`/shop?model=${m.id}`}
                          className="block text-xs text-sf-muted hover:text-sf-text"
                          onClick={() => setOpen(false)}
                        >
                          {m.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
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
