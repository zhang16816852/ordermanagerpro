import { useState, useRef } from "react";
import { usePublicDeviceModels } from "@/storefront/usePublicCatalog";
import { DeviceModelClassifier } from "@/components/classification/DeviceModelClassifier";
import { ChevronDown } from "lucide-react";

export function DeviceModelMegaMenu({
  selectedModels,
  onModelToggle,
  onNavigate,
}: {
  selectedModels: string[];
  onModelToggle: (id: string) => void;
  onNavigate?: () => void;
}) {
  const { data: models } = usePublicDeviceModels();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const tree: Record<string, Record<string, { id?: string; name: string; count: number }[]>> = {};
  const brandNameMap: Record<string, string> = {};
  (models ?? []).forEach((m: any) => {
    const brandId = m.brand_id ?? "__unassigned__";
    if (!tree[brandId]) tree[brandId] = {};
    const seriesKey = "__unassigned__";
    if (!tree[brandId][seriesKey]) tree[brandId][seriesKey] = [];
    tree[brandId][seriesKey].push({ id: m.id, name: m.name, count: m.product_count });
    if (m.brand_id && !brandNameMap[m.brand_id]) {
      brandNameMap[m.brand_id] = m.brand_name || m.brand_id;
    }
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
      <button
        type="button"
        className="sf-link-underline text-[0.9375rem]"
        onClick={() => setOpen((v) => !v)}
      >
        裝置型號{selectedModels.length > 0 ? ` (${selectedModels.length})` : ""}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 w-[min(90vw,420px)] rounded-xl border border-[color:var(--sf-line)] bg-sf-paper p-4 shadow-lg"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <DeviceModelClassifier
            tree={tree}
            brandNameMap={brandNameMap}
            selectedModels={selectedModels}
            onModelToggle={onModelToggle}
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
