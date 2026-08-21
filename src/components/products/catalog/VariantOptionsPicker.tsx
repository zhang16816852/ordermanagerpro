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
        optionDimensions.forEach(dim => {
            results.push({
                key: dim.groupId,
                name: dim.groupName,
                values: dim.values.map((v: any) => ({
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

    return (
        <div className="space-y-6">
            {allDimensions.map(({ key, name, values }) => (
                <div key={key} className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                        {name}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {values.map((val) => {
                            const valueKey = val.id || val.label;
                            const isSelected = selectedOptions[key] === valueKey;
                            const isAvailable = isOptionAvailable(key, valueKey);
                            const qty = badgeQuantity(key, valueKey);
                            return (
                                <Badge
                                    key={valueKey}
                                    variant={isSelected ? "default" : "outline"}
                                    className={cn(
                                        "px-3 py-1.5 cursor-pointer transition-all text-sm flex items-center gap-2",
                                        !isSelected && !isAvailable && "opacity-30 grayscale cursor-not-allowed pointer-events-none",
                                        isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                                    )}
                                    onClick={() => isAvailable && handleOptionClick(key, valueKey)}
                                >
                                    {val.hex_code && (
                                        <div
                                            className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-sm"
                                            style={{ backgroundColor: val.hex_code }}
                                        />
                                    )}
                                    {val.label}
                                    {qty > 0 && (
                                        <span className="ml-1 text-[10px] font-bold text-primary bg-primary/10 rounded-full px-1.5 py-0.5 leading-none">
                                            {qty}
                                        </span>
                                    )}
                                </Badge>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
