import { useState, useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface VariantOptionsPickerProps {
    product: any;
    onVariantSelect: (variant: any | null) => void;
    onSelectionChange?: (selectedOptions: Record<string, string | null>) => void;
    onHasRequiredOptions?: (required: boolean) => void;
    getVariantQuantity?: (variantId: string) => number;
}

export function VariantOptionsPicker({ product, onVariantSelect, onSelectionChange, onHasRequiredOptions, getVariantQuantity }: VariantOptionsPickerProps) {
    const [selectedOptions, setSelectedOptions] = useState<Record<string, string | null>>({});

    const optionDimensions = useMemo(() => {
        if (!product?.option_groups) return [];
        return product.option_groups.map((group: any) => ({
            groupId: group.id,
            groupName: group.name,
            values: group.values || [],
        }));
    }, [product?.option_groups]);

    const variants = useMemo(() => {
        if (!product?.variants) return [];
        return product.variants.map((v: any) => {
            const groupNames = ((v as any).device_model_groups || []).map((g: any) => g?.name).filter(Boolean) as string[];
            const modelNames = ((v as any).device_models || []).map((m: any) => m?.name).filter(Boolean) as string[];

            let modelDisplay = '';
            if (groupNames.length > 0) modelDisplay = groupNames.join(', ');
            else if (modelNames.length > 0) modelDisplay = modelNames.join(', ');
            else {
                const hasOptions = !!(v.option_values?.length > 0);
                modelDisplay = hasOptions ? '' : v.name;
            }
            return { ...v, modelDisplay };
        });
    }, [product?.variants]);

    const allDimensions = useMemo(() => {
        const results: { key: string; name: string; values: { id?: string; label: string; hex_code?: string | null }[] }[] = [];
        const modelNames = Array.from(new Set(variants.map((v: any) => v.modelDisplay))).filter(Boolean) as string[];
        if (modelNames.length > 0) {
            results.push({
                key: 'modelDisplay',
                name: '型號 / 名稱',
                values: modelNames.map(n => ({ label: n }))
            });
        }
        // 僅顯示實際被任一變體使用的選項值，避免改名後殘留的孤兒舊值並存
        const usedValueIds = new Set<string>();
        variants.forEach((v: any) => {
            (v.option_values || []).forEach((ov: any) => {
                if (ov?.id) usedValueIds.add(ov.id);
            });
        });
        optionDimensions.forEach(dim => {
            const filteredValues = (dim.values || []).filter((v: any) => !v.id || usedValueIds.has(v.id));
            results.push({
                key: dim.groupId,
                name: dim.groupName,
                values: filteredValues.map((v: any) => ({
                    id: v.id,
                    label: v.label || v.value,
                    hex_code: v.hex_code
                }))
            });
        });
        return results;
    }, [optionDimensions, variants]);

    useEffect(() => {
        if (product) {
            const initial: Record<string, string | null> = { modelDisplay: null };
            optionDimensions.forEach(dim => {
                initial[dim.groupId] = null;
            });
            setSelectedOptions(initial);
        }
    }, [product?.id]);

    useEffect(() => {
        onHasRequiredOptions?.(optionDimensions.length > 0);
    }, [optionDimensions.length, onHasRequiredOptions]);

    const isOptionAvailable = useCallback((dimKey: string, valueIdOrLabel: string) => {
        const testOptions = { ...selectedOptions, [dimKey]: valueIdOrLabel };
        return variants.some((v: any) => {
            const mModel = !testOptions.modelDisplay || v.modelDisplay === testOptions.modelDisplay;
            const optionEntries = Object.entries(testOptions).filter(([k, val]) => k !== 'modelDisplay' && val != null);
            if (optionEntries.length === 0) return mModel;
            const mOptions = optionEntries.every(([groupId, valueId]) =>
                v.option_values?.some((ov: any) => ov.group_id === groupId && ov.id === valueId)
            );
            return mModel && mOptions;
        });
    }, [selectedOptions, variants]);

    useEffect(() => {
        const nextOptions = { ...selectedOptions };
        let changed = false;

        allDimensions.forEach(({ key, values }) => {
            if (!nextOptions[key]) {
                const useId = !!values[0]?.id;
                const availableValues = values.filter(v => {
                    const val = useId ? v.id : v.label;
                    return val && isOptionAvailable(key, val);
                });
                if (availableValues.length === 1) {
                    nextOptions[key] = (useId ? availableValues[0].id : availableValues[0].label) ?? null;
                    changed = true;
                }
            }
        });

        if (changed) {
            setSelectedOptions(nextOptions);
        }
    }, [allDimensions, selectedOptions, isOptionAvailable]);

    useEffect(() => {
        onSelectionChange?.(selectedOptions);
        const match = variants.find((v: any) => {
            const vModel = v.modelDisplay || null;
            const sModel = selectedOptions.modelDisplay || null;
            if (vModel !== sModel) return false;
            const optionEntries = Object.entries(selectedOptions).filter(([k, val]) => k !== 'modelDisplay' && val != null);
            if (optionEntries.length === 0) return !vModel && (!v.option_values || v.option_values.length === 0);
            return optionEntries.every(([groupId, valueId]) =>
                v.option_values?.some((ov: any) => ov.group_id === groupId && ov.id === valueId)
            );
        });
        onVariantSelect(match || null);
    }, [selectedOptions, variants, onVariantSelect, onSelectionChange]);

    const handleOptionClick = (dimKey: string, value: string) => {
        setSelectedOptions(prev => ({
            ...prev,
            [dimKey]: prev[dimKey] === value ? null : value
        }));
    };

    // 型號維度：依 device_series 自動分組（group 類型無 series，不強制分組）
    const modelSeriesMap = useMemo(() => {
        const map = new Map<string, string>();
        variants.forEach((v: any) => {
            if (!v.modelDisplay || map.has(v.modelDisplay)) return;
            const series = v.device_models?.[0]?.device_series
                || v.device_models?.[0]?.brand_name
                || null;
            if (series) map.set(v.modelDisplay, series);
        });
        return map;
    }, [variants]);

    const badgeQuantity = useCallback((dimKey: string, value: string) => {
        if (!getVariantQuantity) return 0;
        const hasSelectionInOtherDim = allDimensions.some(({ key }) =>
            key !== dimKey && selectedOptions[key] != null
        );
        const isThisSelected = selectedOptions[dimKey] === value;
        if (!hasSelectionInOtherDim && !isThisSelected) return 0;
        const testOptions = { ...selectedOptions, [dimKey]: value };
        const match = variants.find((v: any) => {
            const vModel = v.modelDisplay || null;
            const sModel = testOptions.modelDisplay || null;
            if (vModel !== sModel) return false;
            const optionEntries = Object.entries(testOptions).filter(([k, val]) => k !== 'modelDisplay' && val != null);
            if (optionEntries.length === 0) return !vModel && (!v.option_values || v.option_values.length === 0);
            return optionEntries.every(([groupId, valueId]) =>
                v.option_values?.some((ov: any) => ov.group_id === groupId && ov.id === valueId)
            );
        });
        if (!match) return 0;
        return getVariantQuantity(match.id);
    }, [getVariantQuantity, allDimensions, selectedOptions, variants]);

    if (!product?.variants || variants.length === 0) return null;

    const isModelDim = (k: string) => k === 'modelDisplay';

    // 型號維度：依 series 分組
    const groupModelValues = (vals: { id?: string; label: string; hex_code?: string | null }[]) => {
        const groups = new Map<string, typeof vals>();
        vals.forEach(v => {
            const series = modelSeriesMap.get(v.label) || '其他';
            if (!groups.has(series)) groups.set(series, []);
            groups.get(series)!.push(v);
        });
        // 已選的 series 排前面
        const selectedSeries = modelSeriesMap.get(selectedOptions['modelDisplay'] || '') || null;
        return Array.from(groups.entries()).sort((a, b) => {
            if (selectedSeries && a[0] === selectedSeries) return -1;
            if (selectedSeries && b[0] === selectedSeries) return 1;
            return a[0].localeCompare(b[0], 'zh-Hant');
        });
    };

    const renderPill = (key: string, val: { id?: string; label: string; hex_code?: string | null }, wide: boolean) => {
        const valueKey = val.id || val.label;
        const isSelected = selectedOptions[key] === valueKey;
        const isAvailable = isOptionAvailable(key, valueKey);
        const qty = badgeQuantity(key, valueKey);
        return (
            <Badge
                key={valueKey}
                variant={isSelected ? "default" : "outline"}
                className={cn(
                    wide
                        ? "flex-1 min-w-[calc(50%-0.25rem)] justify-center px-3 py-1.5 cursor-pointer transition-all text-sm flex items-center gap-2"
                        : "px-3 py-1.5 cursor-pointer transition-all text-sm flex items-center gap-2",
                    !isSelected && !isAvailable && "opacity-30 grayscale cursor-not-allowed pointer-events-none",
                    isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                )}
                onClick={() => isAvailable && handleOptionClick(key, valueKey)}
            >
                <div className={cn("flex items-center gap-2 min-w-0", wide && "justify-center flex-1")}>
                    {val.hex_code && (
                        <div
                            className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-sm shrink-0"
                            style={{ backgroundColor: val.hex_code }}
                        />
                    )}
                    <span className={cn("truncate min-w-0", wide && "text-center")}>{val.label}</span>
                    {getVariantQuantity && (
                        <span
                            className={cn(
                                "text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none min-w-[1.25rem] text-center tabular-nums shrink-0",
                                qty > 0
                                    ? (isSelected ? "text-primary-foreground bg-primary-foreground/20" : "text-primary bg-primary/10")
                                    : "opacity-0"
                            )}
                            aria-hidden={qty <= 0}
                        >
                            {qty > 0 ? qty : "\u00A0"}
                        </span>
                    )}
                </div>
            </Badge>
        );
    };

    return (
        <div className="space-y-6">
            {allDimensions.map(({ key, name, values }) => (
                <div key={key} className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                        {name}
                    </h3>
                    {isModelDim(key) && modelSeriesMap.size > 0 ? (
                        <div className="space-y-3">
                            {groupModelValues(values).map(([series, sValues]) => (
                                <div key={series} className="space-y-1.5">
                                    <div className="text-[11px] font-medium text-muted-foreground/80 px-1">
                                        {series} <span className="text-[10px] opacity-60">({sValues.length})</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {sValues.map(val => renderPill(key, val, true))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : isModelDim(key) ? (
                        <div className="flex flex-wrap gap-2">
                            {values.map(val => renderPill(key, val, true))}
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {values.map(val => renderPill(key, val, false))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
