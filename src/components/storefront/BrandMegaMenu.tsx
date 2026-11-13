import { useState, useRef } from "react";
import { usePublicBrands, usePublicBrandSeries } from "@/storefront/usePublicCatalog";
import { BrandClassifier } from "@/components/classification/BrandClassifier";
import { ChevronDown } from "lucide-react";

export function BrandMegaMenu({
  selectedBrands,
  selectedSeries,
  onBrandToggle,
  onSeriesToggle,
  onNavigate,
}: {
  selectedBrands: string[];
  selectedSeries: string[];
  onBrandToggle: (id: string) => void;
  onSeriesToggle: (id: string) => void;
  onNavigate?: () => void;
}) {
  const { data: brands } = usePublicBrands();
  const { data: series } = usePublicBrandSeries();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const seriesByBrand: Record<string, { id: string; name: string; count?: number }[]> = {};
  (series ?? []).forEach((s: any) => {
    if (!seriesByBrand[s.brand_id]) seriesByBrand[s.brand_id] = [];
    seriesByBrand[s.brand_id].push({ id: s.series_id, name: s.series_name, count: s.product_count });
  });

  const brandList = (brands ?? []).map((b: any) => ({ id: b.id, name: b.name, count: b.product_count }));

  const scheduleClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };
  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  };

  const selectedCount = selectedBrands.length + selectedSeries.length;

  return (
    <div className="relative" onMouseEnter={() => { cancelClose(); setOpen(true); }} onMouseLeave={scheduleClose}>
      <button
        type="button"
        className="sf-link-underline text-[0.9375rem]"
        onClick={() => setOpen((v) => !v)}
      >
        品牌 / 系列{selectedCount > 0 ? ` (${selectedCount})` : ""}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(90vw,420px)] rounded-xl border border-[color:var(--sf-line)] bg-sf-paper p-4 shadow-lg"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <BrandClassifier
            brands={brandList}
            childrenByBrand={seriesByBrand}
            selectedBrands={selectedBrands}
            selectedChildren={selectedSeries}
            onBrandToggle={onBrandToggle}
            onChildToggle={onSeriesToggle}
            childLabel="系列"
            searchable
            variant="vertical"
            showCounts
          />
          <div className="mt-3 border-t border-[color:var(--sf-line)] pt-2">
            <button
              type="button"
              className="text-xs text-sf-muted hover:text-sf-text"
              onClick={() => { setOpen(false); onNavigate?.(); }}
            >
              關閉
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
