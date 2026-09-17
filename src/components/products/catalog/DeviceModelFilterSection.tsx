import { useMemo, useState, useEffect } from "react";
import { ChevronDown, Search, Smartphone } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { SectionHeader, EmptyState } from "./sidebarPrimitives";
import { DeviceModelFilterSectionProps } from "./catalogSidebarTypes";
import { useDeviceModelStore } from "@/store/useDeviceModelStore";

export function DeviceModelFilterSection({
    open,
    onOpenChange,
    products,
    selectedDeviceModels,
    onDeviceModelChange,
}: DeviceModelFilterSectionProps) {
    const { models: deviceModels, brands: deviceBrands } = useDeviceModelStore();
    const [modelSearch, setModelSearch] = useState('');
    const [expandedDeviceBrands, setExpandedDeviceBrands] = useState<Set<string>>(new Set());
    const [expandedDeviceSeries, setExpandedDeviceSeries] = useState<Set<string>>(new Set());

    const deviceBrandNameMap = useMemo(() => {
        const map: Record<string, string> = {};
        deviceBrands.forEach((b: any) => { map[b.id] = b.name; });
        return map;
    }, [deviceBrands]);

    const deviceModelLookup = useMemo(() => {
        const map: Record<string, { brand_id: string | null; device_series: string | null }> = {};
        deviceModels.forEach((m: any) => {
            map[m.name] = { brand_id: m.brand_id, device_series: m.device_series };
            (m.aliases || []).forEach((a: string) => {
                map[a] = { brand_id: m.brand_id, device_series: m.device_series };
            });
        });
        return map;
    }, [deviceModels]);

    const deviceModelTree = useMemo(() => {
        const modelCounts: Record<string, number> = {};
        products.forEach(p => {
            const models = (p as any).effective_model_names || [];
            models.forEach((m: string) => {
                if (m) modelCounts[m] = (modelCounts[m] || 0) + 1;
            });
            (p as any).variants?.forEach((v: any) => {
                (v.effective_model_names || []).forEach((m: string) => {
                    if (m) modelCounts[m] = (modelCounts[m] || 0) + 1;
                });
            });
        });

        const searchLower = modelSearch.toLowerCase();
        const tree: Record<string, Record<string, { name: string; count: number }[]>> = {};

        Object.entries(modelCounts).forEach(([name, count]) => {
            if (searchLower && !name.toLowerCase().includes(searchLower)) return;
            const lookup = deviceModelLookup[name];
            const brandId = lookup?.brand_id || '__unassigned__';
            const series = lookup?.device_series || '__unassigned__';
            if (!tree[brandId]) tree[brandId] = {};
            if (!tree[brandId][series]) tree[brandId][series] = [];
            tree[brandId][series].push({ name, count });
        });

        Object.values(tree).forEach(seriesMap => {
            Object.keys(seriesMap).forEach(series => {
                seriesMap[series].sort((a, b) => b.count - a.count);
            });
        });

        return tree;
    }, [products, modelSearch, deviceModelLookup]);

    const totalDeviceModelCount = useMemo(() => {
        let total = 0;
        Object.values(deviceModelTree).forEach(seriesMap => {
            Object.values(seriesMap).forEach(models => { total += models.length; });
        });
        return total;
    }, [deviceModelTree]);

    useEffect(() => {
        if (modelSearch) {
            const brands = new Set<string>();
            const series = new Set<string>();
            Object.entries(deviceModelTree).forEach(([brandId, seriesMap]) => {
                brands.add(brandId);
                Object.keys(seriesMap).forEach(s => series.add(`${brandId}:${s}`));
            });
            setExpandedDeviceBrands(brands);
            setExpandedDeviceSeries(series);
        } else {
            setExpandedDeviceBrands(new Set());
            setExpandedDeviceSeries(new Set());
        }
    }, [modelSearch, deviceModelTree]);

    const toggleDeviceBrandExpand = (brandId: string) => {
        setExpandedDeviceBrands(prev => {
            const next = new Set(prev);
            if (next.has(brandId)) next.delete(brandId);
            else next.add(brandId);
            return next;
        });
    };

    const toggleDeviceSeriesExpand = (key: string) => {
        setExpandedDeviceSeries(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    if (totalDeviceModelCount === 0 && modelSearch === '') return null;

    return (
        <Collapsible open={open} onOpenChange={onOpenChange}>
            <div className="py-2">
                <SectionHeader
                    label="裝置型號"
                    isOpen={open}
                    count={totalDeviceModelCount}
                    selectedCount={selectedDeviceModels.length}
                    icon={Smartphone}
                />
            </div>
            <CollapsibleContent>
                <div className="space-y-1 pb-3">
                    <div className="relative mb-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                        <Input
                            value={modelSearch}
                            onChange={(e) => setModelSearch(e.target.value)}
                            placeholder="搜尋型號..."
                            className="h-7 text-xs pl-6"
                        />
                    </div>
                    <div className="max-h-[300px] overflow-y-auto space-y-0.5">
                        {Object.keys(deviceModelTree).length === 0 && modelSearch && (
                            <EmptyState icon={Smartphone} text="找不到符合的型號" />
                        )}
                        {Object.entries(deviceModelTree)
                            .sort(([a], [b]) => {
                                if (a === '__unassigned__') return 1;
                                if (b === '__unassigned__') return -1;
                                return (deviceBrandNameMap[a] || a).localeCompare(deviceBrandNameMap[b] || b);
                            })
                            .map(([brandId, seriesMap]) => {
                                const brandLabel = brandId === '__unassigned__'
                                    ? '其他'
                                    : (deviceBrandNameMap[brandId] || brandId);
                                const brandModelCount = Object.values(seriesMap).reduce((sum, arr) => sum + arr.length, 0);
                                const isBrandExpanded = expandedDeviceBrands.has(brandId);
                                const seriesEntries = Object.entries(seriesMap).sort(([a], [b]) => {
                                    if (a === '__unassigned__') return 1;
                                    if (b === '__unassigned__') return -1;
                                    return a.localeCompare(b);
                                });
                                const hasSingleUnnamedSeries = seriesEntries.length === 1 && seriesEntries[0][0] === '__unassigned__';

                                if (hasSingleUnnamedSeries) {
                                    return (
                                        <div key={brandId}>
                                            {brandId !== '__unassigned__' && (
                                                <div className="flex items-center rounded-md px-1 py-0.5 hover:bg-muted/50 transition-colors">
                                                    <div className="w-5" />
                                                    <Smartphone className="h-3 w-3 mr-1.5 text-muted-foreground/60" />
                                                    <span className="text-xs font-medium text-foreground">{brandLabel}</span>
                                                    <span className="text-[10px] text-muted-foreground/60 tabular-nums ml-auto mr-1">{brandModelCount}</span>
                                                </div>
                                            )}
                                            <div className={brandId !== '__unassigned__' ? "pl-5 ml-2.5 border-l" : ""}>
                                                {seriesEntries[0][1].map(({ name, count }) => (
                                                    <div key={name} className={cn(
                                                        "flex items-center rounded-md px-1 py-0.5 transition-colors",
                                                        selectedDeviceModels.includes(name) ? "bg-primary/5" : "hover:bg-muted/50"
                                                    )}>
                                                        <div className="w-5" />
                                                        <Checkbox
                                                            id={`model-${name}`}
                                                            checked={selectedDeviceModels.includes(name)}
                                                            onCheckedChange={(checked) => {
                                                                if (onDeviceModelChange) {
                                                                    if (checked) {
                                                                        onDeviceModelChange([...selectedDeviceModels, name]);
                                                                    } else {
                                                                        onDeviceModelChange(selectedDeviceModels.filter((n) => n !== name));
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                        <Label htmlFor={`model-${name}`}
                                                            className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground truncate transition-colors">
                                                            {name}
                                                        </Label>
                                                        <span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={brandId}>
                                        <div
                                            className="flex items-center rounded-md px-1 py-0.5 hover:bg-muted/50 transition-colors cursor-pointer"
                                            onClick={() => toggleDeviceBrandExpand(brandId)}
                                        >
                                            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0">
                                                <ChevronDown className={cn(
                                                    "h-3 w-3 transition-transform duration-200",
                                                    !isBrandExpanded && "-rotate-90"
                                                )} />
                                            </Button>
                                            <Smartphone className="h-3 w-3 mr-1.5 text-muted-foreground/60" />
                                            <span className="text-xs font-medium text-foreground flex-1">{brandLabel}</span>
                                            <span className="text-[10px] text-muted-foreground/60 tabular-nums mr-1">{brandModelCount}</span>
                                        </div>
                                        {isBrandExpanded && (
                                            <div className="pl-5 ml-2.5 border-l space-y-0.5">
                                                {seriesEntries.map(([seriesKey, models]) => {
                                                    const seriesLabel = seriesKey === '__unassigned__' ? '未分類系列' : seriesKey;
                                                    const seriesKeyFull = `${brandId}:${seriesKey}`;
                                                    const isSeriesExpanded = expandedDeviceSeries.has(seriesKeyFull);

                                                    if (models.length === 1) {
                                                        const model = models[0];
                                                        return (
                                                            <div key={seriesKeyFull} className={cn(
                                                                "flex items-center rounded-md px-1 py-0.5 transition-colors",
                                                                selectedDeviceModels.includes(model.name) ? "bg-primary/5" : "hover:bg-muted/50"
                                                            )}>
                                                                <div className="w-5" />
                                                                <Checkbox
                                                                    id={`model-${model.name}`}
                                                                    checked={selectedDeviceModels.includes(model.name)}
                                                                    onCheckedChange={(checked) => {
                                                                        if (onDeviceModelChange) {
                                                                            if (checked) {
                                                                                onDeviceModelChange([...selectedDeviceModels, model.name]);
                                                                            } else {
                                                                                onDeviceModelChange(selectedDeviceModels.filter((n) => n !== model.name));
                                                                            }
                                                                        }
                                                                    }}
                                                                />
                                                                <Label htmlFor={`model-${model.name}`}
                                                                    className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground truncate transition-colors">
                                                                    {model.name}
                                                                </Label>
                                                                <span className="text-[10px] text-muted-foreground tabular-nums">{model.count}</span>
                                                            </div>
                                                        );
                                                    }

                                                    return (
                                                        <div key={seriesKeyFull}>
                                                            <div
                                                                className="flex items-center rounded-md px-1 py-0.5 hover:bg-muted/50 transition-colors cursor-pointer"
                                                                onClick={() => toggleDeviceSeriesExpand(seriesKeyFull)}
                                                            >
                                                                <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0">
                                                                    <ChevronDown className={cn(
                                                                        "h-3 w-3 transition-transform duration-200",
                                                                        !isSeriesExpanded && "-rotate-90"
                                                                    )} />
                                                                </Button>
                                                                <span className="text-xs text-muted-foreground flex-1">{seriesLabel}</span>
                                                                <span className="text-[10px] text-muted-foreground/60 tabular-nums mr-1">{models.length}</span>
                                                            </div>
                                                            {isSeriesExpanded && (
                                                                <div className="pl-5 ml-2.5 border-l space-y-0.5">
                                                                    {models.map(({ name, count }) => (
                                                                        <div key={name} className={cn(
                                                                            "flex items-center rounded-md px-1 py-0.5 transition-colors",
                                                                            selectedDeviceModels.includes(name) ? "bg-primary/5" : "hover:bg-muted/50"
                                                                        )}>
                                                                            <div className="w-5" />
                                                                            <Checkbox
                                                                                id={`model-${name}`}
                                                                                checked={selectedDeviceModels.includes(name)}
                                                                                onCheckedChange={(checked) => {
                                                                                    if (onDeviceModelChange) {
                                                                                        if (checked) {
                                                                                            onDeviceModelChange([...selectedDeviceModels, name]);
                                                                                        } else {
                                                                                            onDeviceModelChange(selectedDeviceModels.filter((n) => n !== name));
                                                                                        }
                                                                                    }
                                                                                }}
                                                                            />
                                                                            <Label htmlFor={`model-${name}`}
                                                                                className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground truncate transition-colors">
                                                                                {name}
                                                                            </Label>
                                                                            <span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
                                                                        </div>
                                                                    ))}
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
                </div>
            </CollapsibleContent>
            <Separator />
        </Collapsible>
    );
}