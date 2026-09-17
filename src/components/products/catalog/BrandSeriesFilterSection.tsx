import { useState } from "react";
import { ChevronDown, Tag } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { SectionHeader, SectionSkeleton, EmptyState } from "./sidebarPrimitives";
import { BrandSeriesFilterSectionProps } from "./catalogSidebarTypes";

export function BrandSeriesFilterSection({
    open,
    onOpenChange,
    brandsLoading,
    brands,
    seriesByBrand,
    seriesCounts,
    selectedBrands,
    onBrandChange,
    selectedSeries,
    onSeriesChange,
}: BrandSeriesFilterSectionProps) {
    const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());

    const toggleBrandExpand = (brandId: string) => {
        setExpandedBrands(prev => {
            const next = new Set(prev);
            if (next.has(brandId)) next.delete(brandId);
            else next.add(brandId);
            return next;
        });
    };

    return (
        <Collapsible open={open} onOpenChange={onOpenChange}>
            <div className="py-2">
                <SectionHeader
                    label="品牌 / 系列"
                    isOpen={open}
                    count={brands.length}
                    selectedCount={selectedBrands.length + selectedSeries.length}
                    icon={Tag}
                />
            </div>
            <CollapsibleContent>
                {brandsLoading ? (
                    <SectionSkeleton rows={4} />
                ) : brands.length === 0 ? (
                    <EmptyState icon={Tag} text="尚未建立品牌" />
                ) : (
                    <div className="pb-3 max-h-[300px] overflow-y-auto space-y-0.5">
                        {brands.map((brand: any) => {
                            const brandSeries = seriesByBrand[brand.id] || [];
                            const hasSeries = brandSeries.length > 0;
                            const isExpanded = expandedBrands.has(brand.id);
                            return (
                                <div key={brand.id}>
                                    <div className={cn(
                                        "flex items-center rounded-md px-1 py-0.5 transition-colors",
                                        selectedBrands.includes(brand.id) ? "bg-primary/5" : "hover:bg-muted/50"
                                    )}>
                                        {hasSeries ? (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5 shrink-0"
                                                onClick={() => toggleBrandExpand(brand.id)}
                                            >
                                                <ChevronDown className={cn(
                                                    "h-3 w-3 transition-transform duration-200",
                                                    !isExpanded && "-rotate-90"
                                                )} />
                                            </Button>
                                        ) : (
                                            <div className="w-5" />
                                        )}
                                        <Checkbox
                                            id={`brand-${brand.id}`}
                                            checked={selectedBrands.includes(brand.id)}
                                            onCheckedChange={(checked) => {
                                                if (onBrandChange) {
                                                    if (checked) {
                                                        onBrandChange([...selectedBrands, brand.id]);
                                                    } else {
                                                        onBrandChange(selectedBrands.filter((id) => id !== brand.id));
                                                    }
                                                }
                                            }}
                                        />
                                        <Label htmlFor={`brand-${brand.id}`}
                                            className="text-sm font-medium cursor-pointer flex-1 py-0.5 text-foreground transition-colors">
                                            {brand.name}
                                        </Label>
                                        {hasSeries && (
                                            <span className="text-[10px] text-muted-foreground/60 tabular-nums mr-1">
                                                {brandSeries.length}
                                            </span>
                                        )}
                                    </div>
                                    {hasSeries && isExpanded && (
                                        <div className="pl-5 ml-2.5 border-l space-y-0.5">
                                            {brandSeries.map((s: any) => (
                                                <div key={s.id} className={cn(
                                                    "flex items-center rounded-md px-1 py-0.5 transition-colors",
                                                    selectedSeries.includes(s.id) ? "bg-primary/5" : "hover:bg-muted/50"
                                                )}>
                                                    <div className="w-5" />
                                                    <Checkbox
                                                        id={`series-${s.id}`}
                                                        checked={selectedSeries.includes(s.id)}
                                                        onCheckedChange={(checked) => {
                                                            if (onSeriesChange) {
                                                                if (checked) {
                                                                    onSeriesChange([...selectedSeries, s.id]);
                                                                } else {
                                                                    onSeriesChange(selectedSeries.filter((id) => id !== s.id));
                                                                }
                                                            }
                                                        }}
                                                    />
                                                    <Label htmlFor={`series-${s.id}`}
                                                        className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground truncate transition-colors">
                                                        {s.name}
                                                    </Label>
                                                    {seriesCounts[s.id] !== undefined && (
                                                        <span className="text-[10px] text-muted-foreground tabular-nums">{seriesCounts[s.id]}</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </CollapsibleContent>
            <Separator />
        </Collapsible>
    );
}