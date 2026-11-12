import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { SearchInput } from "./primitives/SearchInput";
import type { ClassificationVariant } from "./types";

export type BrandClassifierProps = {
  brands: { id: string; name: string; count?: number }[];
  childrenByBrand: Record<string, { id: string; name: string; count?: number }[]>;
  grandchildrenByChild?: Record<string, { id: string; name: string; count?: number }[]>;
  selectedBrands: string[];
  selectedChildren: string[];
  selectedGrandchildren?: string[];
  onBrandToggle: (id: string) => void;
  onChildToggle: (id: string) => void;
  onGrandchildToggle?: (id: string) => void;
  childLabel?: string;
  grandchildLabel?: string;
  searchable?: boolean;
  defaultExpanded?: boolean;
  variant?: ClassificationVariant;
  showCounts?: boolean;
  className?: string;
};

export function BrandClassifier({
  brands,
  childrenByBrand,
  grandchildrenByChild,
  selectedBrands,
  selectedChildren,
  selectedGrandchildren = [],
  onBrandToggle,
  onChildToggle,
  onGrandchildToggle,
  childLabel,
  grandchildLabel,
  searchable = false,
  defaultExpanded = false,
  variant = "responsive",
  showCounts = true,
  className,
}: BrandClassifierProps) {
  const [search, setSearch] = useState("");
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(
    () => (defaultExpanded ? new Set(brands.map((b) => b.id)) : new Set()),
  );
  const [expandedChildren, setExpandedChildren] = useState<Set<string>>(new Set());

  const toggleBrand = (id: string) =>
    setExpandedBrands((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleChild = (id: string) =>
    setExpandedChildren((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => {
      if (b.name.toLowerCase().includes(q)) return true;
      const kids = childrenByBrand[b.id] ?? [];
      return kids.some((c) => c.name.toLowerCase().includes(q));
    });
  }, [brands, search, childrenByBrand]);

  const renderVertical = () => (
    <div className="space-y-1">
      {searchable && (
        <SearchInput value={search} onChange={setSearch} placeholder="搜尋品牌/系列..." className="mb-2" />
      )}
      {filteredBrands.map((brand) => {
        const kids = childrenByBrand[brand.id] ?? [];
        const hasKids = kids.length > 0;
        const expanded = expandedBrands.has(brand.id);
        return (
          <Collapsible key={brand.id} open={expanded} onOpenChange={() => toggleBrand(brand.id)}>
            <div className="flex items-center gap-2 py-1">
              {hasKids ? (
                <Button type="button" variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => toggleBrand(brand.id)}>
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </Button>
              ) : (
                <span className="h-5 w-5 shrink-0" />
              )}
              <Checkbox
                id={`brand-${brand.id}`}
                checked={selectedBrands.includes(brand.id)}
                onCheckedChange={() => onBrandToggle(brand.id)}
              />
              <Label htmlFor={`brand-${brand.id}`} className="text-sm font-medium cursor-pointer flex-1 truncate">
                {brand.name}
                {showCounts && brand.count != null && <span className="ml-1 text-xs opacity-60">({brand.count})</span>}
              </Label>
            </div>
            {hasKids && expanded && (
              <CollapsibleContent>
                <div className="ml-5 pl-2.5 border-l space-y-0.5 py-1">
                  {kids.map((kid) => {
                    const gkids = grandchildrenByChild?.[kid.id] ?? [];
                    const hasGkids = gkids.length > 0;
                    const kidExpanded = expandedChildren.has(kid.id);
                    const kidSelected = selectedChildren.includes(kid.id);
                    return (
                      <div key={kid.id}>
                        <div className="flex items-center gap-2 py-0.5">
                          {hasGkids ? (
                            <Button type="button" variant="ghost" size="icon" className="h-4 w-4 shrink-0" onClick={() => toggleChild(kid.id)}>
                              {kidExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            </Button>
                          ) : (
                            <span className="h-4 w-4 shrink-0" />
                          )}
                          <Checkbox
                            id={`child-${kid.id}`}
                            checked={kidSelected}
                            onCheckedChange={() => onChildToggle(kid.id)}
                          />
                          <Label htmlFor={`child-${kid.id}`} className="text-sm font-normal cursor-pointer flex-1 truncate text-muted-foreground hover:text-foreground">
                            {kid.name}
                            {showCounts && kid.count != null && <span className="ml-1 text-xs opacity-60">({kid.count})</span>}
                          </Label>
                        </div>
                        {hasGkids && kidExpanded && (
                          <div className="ml-4 pl-2.5 border-l space-y-0.5 py-1">
                            {gkids.map((gk) => (
                              <div key={gk.id} className="flex items-center gap-2 py-0.5">
                                <span className="h-4 w-4 shrink-0" />
                                <Checkbox
                                  id={`gk-${gk.id}`}
                                  checked={selectedGrandchildren.includes(gk.id)}
                                  onCheckedChange={() => onGrandchildToggle?.(gk.id)}
                                />
                                <Label htmlFor={`gk-${gk.id}`} className="text-sm font-normal cursor-pointer flex-1 truncate text-muted-foreground hover:text-foreground">
                                  {gk.name}
                                  {showCounts && gk.count != null && <span className="ml-1 text-xs opacity-60">({gk.count})</span>}
                                </Label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CollapsibleContent>
            )}
          </Collapsible>
        );
      })}
    </div>
  );

  const renderHorizontal = () => (
    <div className="space-y-2">
      {searchable && <SearchInput value={search} onChange={setSearch} placeholder="搜尋品牌/系列..." />}
      <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
        {filteredBrands.map((brand) => {
          const selected = selectedBrands.includes(brand.id);
          return (
            <button
              key={brand.id}
              type="button"
              onClick={() => onBrandToggle(brand.id)}
              className={cn(
                "shrink-0 snap-start sf-link-underline text-[0.9375rem] transition-colors",
                selected ? "text-sf-text font-medium" : "text-sf-muted hover:text-sf-text",
              )}
            >
              {brand.name}
              {showCounts && brand.count != null && <span className="ml-1 opacity-70">({brand.count})</span>}
            </button>
          );
        })}
      </div>
      {selectedBrands.map((bid) => {
        const brand = brands.find((b) => b.id === bid);
        const kids = childrenByBrand[bid] ?? [];
        if (!brand || kids.length === 0) return null;
        return (
          <div key={bid} className="rounded-md border bg-muted/30 p-2 space-y-1">
            <div className="text-xs font-medium text-foreground">{brand.name} · {childLabel ?? "系列"}</div>
            <div className="flex flex-wrap gap-1.5">
              {kids.map((kid) => {
                const selected = selectedChildren.includes(kid.id);
                return (
                  <button
                    key={kid.id}
                    type="button"
                    onClick={() => onChildToggle(kid.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                      selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    {kid.name}
                    {showCounts && kid.count != null && <span className="ml-1 opacity-60">({kid.count})</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (variant === "vertical") return <div className={cn("space-y-1", className)}>{renderVertical()}</div>;
  if (variant === "horizontal") return <div className={cn("space-y-1", className)}>{renderHorizontal()}</div>;

  return (
    <div className={cn(className)}>
      <div className="hidden md:block">{renderVertical()}</div>
      <div className="md:hidden">{renderHorizontal()}</div>
    </div>
  );
}
