import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MarketFilters {
  listing_type: string;
  brand: string;
  condition: string;
  priceMin: string;
  priceMax: string;
}

const LISTING_TYPES = [
  { value: "", label: "全部" },
  { value: "sell", label: "出售" },
  { value: "buy", label: "收購" },
  { value: "service", label: "服務" },
];

const BRANDS = ["Apple", "Samsung", "ASUS", "Sony", "Google", "小米", "OPPO", "vivo", "其他"];
const CONDITIONS = ["全新", "二手-近全新", "二手-良好", "二手-一般", "零件機"];

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-sm border transition-all",
        active
          ? "bg-primary text-primary-foreground border-primary font-medium"
          : "bg-muted/40 text-muted-foreground border-white/10 hover:border-primary/40"
      )}
    >
      {label}
    </button>
  );
}

interface MarketFiltersDrawerProps {
  filters: MarketFilters;
  onChange: (f: MarketFilters) => void;
  activeCount: number;
}

export function MarketFiltersDrawer({ filters, onChange, activeCount }: MarketFiltersDrawerProps) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<MarketFilters>(filters);

  const handleOpen = () => {
    setLocal(filters);
    setOpen(true);
  };

  const handleApply = () => {
    onChange(local);
    setOpen(false);
  };

  const handleReset = () => {
    const empty: MarketFilters = { listing_type: "", brand: "", condition: "", priceMin: "", priceMax: "" };
    setLocal(empty);
    onChange(empty);
    setOpen(false);
  };

  const toggle = (field: keyof MarketFilters, value: string) =>
    setLocal((prev) => ({ ...prev, [field]: prev[field] === value ? "" : value }));

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 border-white/10 text-sm"
        onClick={handleOpen}
        id="market-filter-btn"
      >
        <SlidersHorizontal className="h-4 w-4" />
        篩選
        {activeCount > 0 && (
          <Badge className="h-4 w-4 p-0 flex items-center justify-center text-[10px] rounded-full">
            {activeCount}
          </Badge>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto pb-8">
          <SheetHeader className="text-left mb-4">
            <SheetTitle className="flex items-center justify-between">
              篩選條件
              {activeCount > 0 && (
                <button onClick={handleReset} className="text-sm text-muted-foreground flex items-center gap-1 hover:text-foreground">
                  <X className="h-3 w-3" /> 清除全部
                </button>
              )}
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-6">
            {/* Type */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">類型</Label>
              <div className="flex flex-wrap gap-2">
                {LISTING_TYPES.map((t) => (
                  <FilterChip
                    key={t.value}
                    label={t.label}
                    active={local.listing_type === t.value}
                    onClick={() => toggle("listing_type", t.value)}
                  />
                ))}
              </div>
            </div>

            {/* Brand */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">品牌</Label>
              <div className="flex flex-wrap gap-2">
                {BRANDS.map((b) => (
                  <FilterChip
                    key={b}
                    label={b}
                    active={local.brand === b}
                    onClick={() => toggle("brand", b)}
                  />
                ))}
              </div>
            </div>

            {/* Condition */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">物況</Label>
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map((c) => (
                  <FilterChip
                    key={c}
                    label={c}
                    active={local.condition === c}
                    onClick={() => toggle("condition", c)}
                  />
                ))}
              </div>
            </div>

            {/* Price Range */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">預算範圍 (NT$)</Label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="最低"
                  value={local.priceMin}
                  onChange={(e) => setLocal((p) => ({ ...p, priceMin: e.target.value }))}
                  className="flex-1 rounded-lg border border-white/10 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="text-muted-foreground text-sm">—</span>
                <input
                  type="number"
                  placeholder="最高"
                  value={local.priceMax}
                  onChange={(e) => setLocal((p) => ({ ...p, priceMax: e.target.value }))}
                  className="flex-1 rounded-lg border border-white/10 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          <div className="mt-6">
            <Button className="w-full h-12 rounded-xl text-base font-semibold" onClick={handleApply}>
              套用篩選
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
