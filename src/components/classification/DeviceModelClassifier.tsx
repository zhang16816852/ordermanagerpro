import { useState, useMemo, useEffect } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ClassificationVariant } from "./types";

export type DeviceModelClassifierProps = {
  tree: Record<string, Record<string, { name: string; count: number }[]>>;
  brandNameMap?: Record<string, string>;
  selectedModels: string[];
  onModelToggle: (name: string) => void;
  searchable?: boolean;
  defaultExpanded?: boolean;
  variant?: ClassificationVariant;
  showCounts?: boolean;
  className?: string;
};

export function DeviceModelClassifier({
  tree,
  brandNameMap = {},
  selectedModels,
  onModelToggle,
  searchable = true,
  defaultExpanded = false,
  variant = "responsive",
  showCounts = true,
  className,
}: DeviceModelClassifierProps) {
  const [search, setSearch] = useState("");
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(
    () => (defaultExpanded ? new Set(Object.keys(tree)) : new Set()),
  );
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());

  const toggleBrand = (id: string) =>
    setExpandedBrands((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleSeries = (key: string) =>
    setExpandedSeries((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  // filtered tree by search
  const filteredTree = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tree;
    const out: typeof tree = {};
    Object.entries(tree).forEach(([brandId, seriesMap]) => {
      const brandLabel = brandNameMap[brandId] || brandId;
      const newSeriesMap: typeof seriesMap = {};
      Object.entries(seriesMap).forEach(([seriesKey, models]) => {
        const filteredModels = models.filter((m) => m.name.toLowerCase().includes(q));
        if (filteredModels.length > 0 || brandLabel.toLowerCase().includes(q) || seriesKey.toLowerCase().includes(q)) {
          newSeriesMap[seriesKey] = filteredModels.length > 0 ? filteredModels : models;
        }
      });
      if (Object.keys(newSeriesMap).length > 0) out[brandId] = newSeriesMap;
    });
    return out;
  }, [tree, search, brandNameMap]);

  // auto-expand on search
  useEffect(() => {
    if (search.trim()) {
      setExpandedBrands(new Set(Object.keys(filteredTree)));
      const seriesKeys = new Set<string>();
      Object.entries(filteredTree).forEach(([brandId, seriesMap]) => {
        Object.keys(seriesMap).forEach((s) => seriesKeys.add(`${brandId}:${s}`));
      });
      setExpandedSeries(seriesKeys);
    } else {
      // reset to default when search cleared
    }
  }, [search, filteredTree]);

  const totalCount = useMemo(() => {
    let t = 0;
    Object.values(tree).forEach((sm) => Object.values(sm).forEach((ms) => (t += ms.length)));
    return t;
  }, [tree]);

  const renderVertical = () => {
    const brandEntries = Object.entries(filteredTree).sort(([a], [b]) => {
      if (a === "__unassigned__") return 1;
      if (b === "__unassigned__") return -1;
      return (brandNameMap[a] || a).localeCompare(brandNameMap[b] || b);
    });
    if (brandEntries.length === 0) {
      return <div className="py-4 text-center text-xs text-muted-foreground">找不到符合的型號</div>;
    }
    return (
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {brandEntries.map(([brandId, seriesMap]) => {
          const brandLabel = brandId === "__unassigned__" ? "其他" : brandNameMap[brandId] || brandId;
          const brandCount = Object.values(seriesMap).reduce((s, ms) => s + ms.length, 0);
          const isBrandExpanded = expandedBrands.has(brandId);
          const seriesEntries = Object.entries(seriesMap).sort(([a], [b]) => {
            if (a === "__unassigned__") return 1;
            if (b === "__unassigned__") return -1;
            return a.localeCompare(b);
          });
          const singleUnnamed = seriesEntries.length === 1 && seriesEntries[0][0] === "__unassigned__";
          if (singleUnnamed) {
            return (
              <div key={brandId}>
                {brandId !== "__unassigned__" && (
                  <div className="flex items-center rounded-md px-1 py-0.5">
                    <span className="text-xs font-medium text-foreground flex-1">{brandLabel}</span>
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">{brandCount}</span>
                  </div>
                )}
                <div className={brandId !== "__unassigned__" ? "pl-3 border-l ml-2" : ""}>
                  {seriesEntries[0][1].map(({ name, count }) => {
                    const checked = selectedModels.includes(name);
                    return (
                      <div key={name} className="flex items-center gap-2 py-0.5">
                        <Checkbox id={`model-${name}`} checked={checked} onCheckedChange={() => onModelToggle(name)} />
                        <Label htmlFor={`model-${name}`} className="text-sm font-normal cursor-pointer flex-1 truncate text-muted-foreground hover:text-foreground">
                          {name}
                          {showCounts && <span className="ml-1 text-xs opacity-60">({count})</span>}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }
          return (
            <div key={brandId}>
              <div
                className="flex items-center rounded-md px-1 py-0.5 hover:bg-muted/50 cursor-pointer"
                onClick={() => toggleBrand(brandId)}
              >
                <Button type="button" variant="ghost" size="icon" className="h-5 w-5 shrink-0">
                  <ChevronDown className={cn("h-3 w-3 transition-transform", !isBrandExpanded && "-rotate-90")} />
                </Button>
                <span className="text-xs font-medium text-foreground flex-1">{brandLabel}</span>
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">{brandCount}</span>
              </div>
              {isBrandExpanded && (
                <div className="pl-3 ml-2 border-l space-y-0.5">
                  {seriesEntries.map(([seriesKey, models]) => {
                    const seriesLabel = seriesKey === "__unassigned__" ? "未分類系列" : seriesKey;
                    const seriesKeyFull = `${brandId}:${seriesKey}`;
                    const isSeriesExpanded = expandedSeries.has(seriesKeyFull);
                    if (models.length === 1) {
                      const m = models[0];
                      const checked = selectedModels.includes(m.name);
                      return (
                        <div key={seriesKeyFull} className="flex items-center gap-2 py-0.5">
                          <Checkbox id={`model-${m.name}`} checked={checked} onCheckedChange={() => onModelToggle(m.name)} />
                          <Label htmlFor={`model-${m.name}`} className="text-sm font-normal cursor-pointer flex-1 truncate text-muted-foreground hover:text-foreground">
                            {m.name}
                            {showCounts && <span className="ml-1 text-xs opacity-60">({m.count})</span>}
                          </Label>
                        </div>
                      );
                    }
                    return (
                      <div key={seriesKeyFull}>
                        <div
                          className="flex items-center rounded-md px-1 py-0.5 hover:bg-muted/50 cursor-pointer"
                          onClick={() => toggleSeries(seriesKeyFull)}
                        >
                          <Button type="button" variant="ghost" size="icon" className="h-5 w-5 shrink-0">
                            <ChevronDown className={cn("h-3 w-3 transition-transform", !isSeriesExpanded && "-rotate-90")} />
                          </Button>
                          <span className="text-xs text-muted-foreground flex-1">{seriesLabel}</span>
                          <span className="text-[10px] text-muted-foreground/60 tabular-nums">{models.length}</span>
                        </div>
                        {isSeriesExpanded && (
                          <div className="pl-4 ml-2 border-l space-y-0.5">
                            {models.map(({ name, count }) => {
                              const checked = selectedModels.includes(name);
                              return (
                                <div key={name} className="flex items-center gap-2 py-0.5">
                                  <Checkbox id={`model-${name}`} checked={checked} onCheckedChange={() => onModelToggle(name)} />
                                  <Label htmlFor={`model-${name}`} className="text-sm font-normal cursor-pointer flex-1 truncate text-muted-foreground hover:text-foreground">
                                    {name}
                                    {showCounts && <span className="ml-1 text-xs opacity-60">({count})</span>}
                                  </Label>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderHorizontal = () => {
    const allModels = Object.values(tree).flatMap((sm) => Object.values(sm).flat());
    const uniqueBrands = Object.keys(tree);
    return (
      <div className="space-y-2">
        {searchable && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋型號..." className="h-8 text-xs pl-7" />
          </div>
        )}
        <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
          {uniqueBrands.map((bid) => {
            const label = brandNameMap[bid] || bid;
            const selectedCount = Object.values(tree[bid] || {}).flat().filter((m) => selectedModels.includes(m.name)).length;
            const expanded = expandedBrands.has(bid);
            return (
              <button
                key={bid}
                type="button"
                onClick={() => toggleBrand(bid)}
                className={cn(
                  "shrink-0 snap-start rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  expanded || selectedCount > 0 ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-muted",
                )}
              >
                {label}
                {selectedCount > 0 && <span className="ml-1">({selectedCount})</span>}
              </button>
            );
          })}
        </div>
        {Array.from(expandedBrands).map((bid) => {
          const seriesMap = tree[bid] || {};
          const models = Object.values(seriesMap).flat();
          const selectedInBrand = models.filter((m) => selectedModels.includes(m.name));
          return (
            <div key={bid} className="rounded-md border bg-muted/30 p-2 space-y-1">
              <div className="text-xs font-medium text-foreground">{brandNameMap[bid] || bid}</div>
              <div className="flex flex-wrap gap-1.5">
                {models.map((m) => {
                  const checked = selectedModels.includes(m.name);
                  return (
                    <button
                      key={m.name}
                      type="button"
                      onClick={() => onModelToggle(m.name)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted",
                      )}
                    >
                      {m.name}
                      {showCounts && <span className="ml-1 opacity-60">({m.count})</span>}
                    </button>
                  );
                })}
              </div>
              {selectedInBrand.length > 0 && (
                <div className="text-[10px] text-muted-foreground">已選 {selectedInBrand.length} 個型號</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  if (variant === "vertical") return <div className={cn("space-y-1", className)}>{renderVertical()}</div>;
  if (variant === "horizontal") return <div className={cn(className)}>{renderHorizontal()}</div>;

  return (
    <div className={cn(className)}>
      <div className="hidden md:block">{renderVertical()}</div>
      <div className="md:hidden">{renderHorizontal()}</div>
    </div>
  );
}
