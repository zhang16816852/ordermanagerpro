// src/components/order/VariantOptionsPicker.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useProductColors } from "@/hooks/useProductColors";

interface VariantOptionsPickerProps {
    product: any;
    onVariantSelect: (variant: any | null) => void;
    onSelectionChange?: (selectedOptions: Record<string, string | null>) => void;
}

/**
 * [V7.5] 多層級規格選擇器組件
 * 封裝了自動選取、可用性檢查與多維度標籤渲染邏輯
 */
export function VariantOptionsPicker({ product, onVariantSelect, onSelectionChange }: VariantOptionsPickerProps) {
    const { colors } = useProductColors();
    const [selectedOptions, setSelectedOptions] = useState<{ [key: string]: string | null }>({
        option_1: null,
        option_2: null,
        option_3: null,
        modelDisplay: null
    });

    // 1. 預處理變體資料 (計算 modelDisplay)
    const variants = useMemo(() => {
        if (!product?.variants) return [];
        return product.variants.map((v: any) => {
            const groupNames = ((v as any).device_model_groups || []).map((g: any) => g?.name).filter(Boolean) as string[];
            const modelNames = ((v as any).device_models || []).map((m: any) => m?.name).filter(Boolean) as string[];

            let modelDisplay = '';
            if (groupNames.length > 0) modelDisplay = groupNames.join(', ');
            else if (modelNames.length > 0) modelDisplay = modelNames.join(', ');
            else {
                const hasOptions = !!(v.option_1 || v.option_2 || v.option_3);
                modelDisplay = hasOptions ? '' : v.name;
            }
            return { ...v, modelDisplay };
        });
    }, [product?.variants]);

    // 2. 提取維度資訊
    const optionDimensions = useMemo(() => {
        const dims: { [key: string]: string[] } = { option_1: [], option_2: [], option_3: [] };
        variants.forEach((v: any) => {
            if (v.option_1 && !dims.option_1.includes(v.option_1)) dims.option_1.push(v.option_1);
            if (v.option_2 && !dims.option_2.includes(v.option_2)) dims.option_2.push(v.option_2);
            if (v.option_3 && !dims.option_3.includes(v.option_3)) dims.option_3.push(v.option_3);
        });
        const filteredDims = Object.entries(dims).filter(([_, values]) => values.length > 0);
        const modelNames = Array.from(new Set(variants.map((v: any) => v.modelDisplay))).filter(Boolean) as string[];
        
        const results: [string, string[]][] = [];
        if (modelNames.length > 0) results.push(['modelDisplay', modelNames]);
        filteredDims.forEach(([k, v]) => results.push([k, v]));
        
        return results;
    }, [variants]);

    // 3. 檢查選項可用性
    const isOptionAvailable = useCallback((dimKey: string, value: string) => {
        const testOptions = { ...selectedOptions, [dimKey]: value };
        return variants.some((v: any) => {
            const mModel = !testOptions.modelDisplay || v.modelDisplay === testOptions.modelDisplay;
            const mO1 = !testOptions.option_1 || v.option_1 === testOptions.option_1;
            const mO2 = !testOptions.option_2 || v.option_2 === testOptions.option_2;
            const mO3 = !testOptions.option_3 || v.option_3 === testOptions.option_3;
            return mModel && mO1 && mO2 && mO3;
        });
    }, [selectedOptions, variants]);

    // 4. 重置與自動選取邏輯
    useEffect(() => {
        if (product) {
            setSelectedOptions({
                option_1: null,
                option_2: null,
                option_3: null,
                modelDisplay: null
            });
        }
    }, [product?.id]);

    useEffect(() => {
        const nextOptions = { ...selectedOptions };
        let changed = false;

        optionDimensions.forEach(([dimKey, values]) => {
            if (!nextOptions[dimKey]) {
                const availableValues = values.filter(v => isOptionAvailable(dimKey, v));
                if (availableValues.length === 1) {
                    nextOptions[dimKey] = availableValues[0];
                    changed = true;
                }
            }
        });

        if (changed) {
            setSelectedOptions(nextOptions);
        }
    }, [optionDimensions, selectedOptions, isOptionAvailable]);

    // 5. 匹配變體並回傳 + 通知外部當前選項
    useEffect(() => {
        onSelectionChange?.(selectedOptions);
        const match = variants.find((v: any) => {
            const vModel = v.modelDisplay || null;
            const sModel = selectedOptions.modelDisplay || null;
            return vModel === sModel &&
                v.option_1 === selectedOptions.option_1 &&
                v.option_2 === selectedOptions.option_2 &&
                v.option_3 === selectedOptions.option_3;
        });
        onVariantSelect(match || null);
    }, [selectedOptions, variants, onVariantSelect, onSelectionChange]);

    const handleOptionClick = (dimKey: string, value: string) => {
        setSelectedOptions(prev => ({
            ...prev,
            [dimKey]: prev[dimKey] === value ? null : value
        }));
    };

    if (!product.has_variants || variants.length === 0) return null;

    return (
        <div className="space-y-6">
            {optionDimensions.map(([dimKey, values]) => (
                <div key={dimKey} className="space-y-3">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                        {dimKey === 'modelDisplay' ? '型號 / 名稱' :
                            dimKey === 'option_1' ? '規格 / 屬性' :
                                dimKey === 'option_2' ? '類型 / 附加規格' :
                                    dimKey === 'option_3' ? '顏色 / 樣式' : '規格選項'}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {values.map((val: string) => {
                            const isSelected = selectedOptions[dimKey] === val;
                            const isAvailable = isOptionAvailable(dimKey, val);
                            return (
                                <Badge
                                    key={val}
                                    variant={isSelected ? "default" : "outline"}
                                    className={cn(
                                        "px-3 py-1.5 cursor-pointer transition-all text-sm flex items-center gap-2",
                                        !isSelected && !isAvailable && "opacity-30 grayscale cursor-not-allowed pointer-events-none",
                                        isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                                    )}
                                    onClick={() => isAvailable && handleOptionClick(dimKey, val)}
                                >
                                    {dimKey === 'option_3' && (() => {
                                        const color = colors.find(c => c.name === val);
                                        if (color) {
                                            return (
                                                <div
                                                    className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-sm"
                                                    style={{ backgroundColor: color.hex_code }}
                                                />
                                            );
                                        }
                                        return null;
                                    })()}
                                    {val}
                                </Badge>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
