import { useState, useMemo, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProductWithPricing, VariantWithPricing } from "@/types/product";
import { useStoreDraft } from "@/stores/useOrderDraftStore";
import { toast } from "sonner";
import { ShoppingCart, ImageIcon } from "lucide-react";
import { useSpecStore } from "@/store/useSpecStore";
import { supabase } from "@/integrations/supabase/client";
import { formatSpecValue, deserializeSpecs, getTreeSortedVisiblePaths, getVisibleSpecsTree } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";
import { calculatePriceRange } from "@/utils/priceUtils";
import { useProductColors } from "@/hooks/useProductColors";

interface ProductDetailDialogProps {
    product: ProductWithPricing | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    storeId: string;
}

/**
 * 產品詳情彈窗組件
 */
export function ProductDetailDialog({
    product,
    open,
    onOpenChange,
    storeId,
}: ProductDetailDialogProps) {
    const { addItem, getItemQuantity } = useStoreDraft(storeId);
    const { getBrandName } = useBrands();
    const { colors } = useProductColors();
    const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
    const [selectedOptions, setSelectedOptions] = useState<{ [key: string]: string | null }>({
        option_1: null,
        option_2: null,
        option_3: null,
        modelDisplay: null
    });

    // 當彈窗開啟或產品改變時，重置選項
    useEffect(() => {
        if (open) {
            setSelectedVariantId(null);
            setSelectedOptions({
                option_1: null,
                option_2: null,
                option_3: null,
                modelDisplay: null
            });
        }
    }, [open, product?.id]);

    const { specDefinitions, specTriggers, categoryLinks, fetchSpecs } = useSpecStore();

    useEffect(() => {
        if (open && specDefinitions.length === 0) {
            fetchSpecs();
        }
    }, [open, specDefinitions.length, fetchSpecs]);

    // 獲取目前選中的變體物件
    const selectedVariant = useMemo(() => {
        if (!selectedVariantId || !product?.variants) return null;
        return product.variants.find(v => v.id === selectedVariantId) || null;
    }, [product?.variants, selectedVariantId]);

    const effectiveModels = useMemo(() => {
        const target = selectedVariant || product;
        if (!target) return [];
        return (target as any).effective_model_names || [];
    }, [product, selectedVariant]);

    // 預處理變體維度
    const variants = useMemo(() => {
        if (!product?.variants) return [];
        return product.variants.map(v => {
            const groupNames = (v as any).variant_model_group_links?.map((l: any) => l.device_model_groups?.name).filter(Boolean) || [];
            const modelNames = (v as any).variant_model_links?.map((l: any) => l.device_models?.name).filter(Boolean) || [];

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

    const optionDimensions = useMemo(() => {
        const dims: { [key: string]: string[] } = { option_1: [], option_2: [], option_3: [] };
        variants.forEach(v => {
            if (v.option_1 && !dims.option_1.includes(v.option_1)) dims.option_1.push(v.option_1);
            if (v.option_2 && !dims.option_2.includes(v.option_2)) dims.option_2.push(v.option_2);
            if (v.option_3 && !dims.option_3.includes(v.option_3)) dims.option_3.push(v.option_3);
        });
        const filteredDims = Object.entries(dims).filter(([_, values]) => values.length > 0);
        const modelNames = Array.from(new Set(variants.map(v => v.modelDisplay))).filter(Boolean);
        if (modelNames.length > 0) {
            return [['modelDisplay', modelNames], ...filteredDims] as [string, string[]][];
        }
        return filteredDims as [string, string[]][];
    }, [variants]);

    const isOptionAvailable = useCallback((dimKey: string, value: string) => {
        const testOptions = { ...selectedOptions, [dimKey]: value };
        return variants.some(v => {
            const mModel = !testOptions.modelDisplay || v.modelDisplay === testOptions.modelDisplay;
            const mO1 = !testOptions.option_1 || v.option_1 === testOptions.option_1;
            const mO2 = !testOptions.option_2 || v.option_2 === testOptions.option_2;
            const mO3 = !testOptions.option_3 || v.option_3 === testOptions.option_3;
            return mModel && mO1 && mO2 && mO3;
        });
    }, [variants, selectedOptions]);

    useEffect(() => {
        if (!product?.has_variants) return;
        const match = variants.find(v => {
            return (v.modelDisplay || null) === (selectedOptions.modelDisplay || null) &&
                v.option_1 === selectedOptions.option_1 &&
                v.option_2 === selectedOptions.option_2 &&
                v.option_3 === selectedOptions.option_3;
        });
        setSelectedVariantId(match ? match.id : null);
    }, [selectedOptions, variants, product?.has_variants]);

    const handleOptionClick = (dimKey: string, value: string) => {
        setSelectedOptions(prev => ({
            ...prev,
            [dimKey]: prev[dimKey] === value ? null : value
        }));
    };

    // --- 規格彙整與排序邏輯 ---
    const combinedSpecs = useMemo(() => {
        if (!product || specDefinitions.length === 0) return [];

        // 1. 建立分類專屬排序權重表 (Category Sort Map)
        const productCategoryIds = (product as any).category_ids || [];
        const categorySortMap: Record<string, number> = {};

        categoryLinks
            .filter(link => productCategoryIds.includes(link.category_id))
            .forEach(link => {
                if (categorySortMap[link.spec_id] === undefined || link.sort_order < categorySortMap[link.spec_id]) {
                    categorySortMap[link.spec_id] = link.sort_order;
                }
            });

        // 2. 建立以 specId 為主的彙整表
        const specIdAgg = new Map<string, { rawValues: any[], stringifiedSet: Set<string> }>();
        const addValue = (pathKey: string, val: any) => {
            if (val === null || val === undefined || val === '') return;
            // 提取真正的 specId (從 A:B:C 中提取 B)
            const parts = pathKey.split(':');
            const specId = parts.length >= 2 ? parts[1] : pathKey;

            if (!specIdAgg.has(specId)) {
                specIdAgg.set(specId, { rawValues: [], stringifiedSet: new Set() });
            }
            const agg = specIdAgg.get(specId)!;
            const sVal = JSON.stringify(val);
            if (!agg.stringifiedSet.has(sVal)) {
                agg.stringifiedSet.add(sVal);
                agg.rawValues.push(val);
            }
        };

        // 收集產品與變體的所有規格數據
        if (product.spec_values) Object.entries(product.spec_values).forEach(([k, v]) => addValue(k, v));
        const vList = selectedVariantId ? variants.filter(v => v.id === selectedVariantId) : variants;
        vList.forEach(v => {
            if (v.spec_values) Object.entries(v.spec_values).forEach(([k, val]) => addValue(k, val));
        });

        // 2. 建立一個「智慧值字典」給 getVisibleSpecsTree 使用
        // 透過 Proxy 讓連動計算時，不管傳入什麼路徑 (pathKey)，都能對應到正確的 specId 數值
        const flattenedValues: Record<string, any> = {};
        specIdAgg.forEach((agg, specId) => { flattenedValues[specId] = agg.rawValues[0]; });

        const valueProxy = new Proxy(flattenedValues, {
            get: (target, prop: string) => {
                if (typeof prop !== 'string') return undefined;
                const sid = prop.includes(':') ? prop.split(':')[1] : prop;
                return target[sid];
            }
        });

        // 3. 計算可見路徑 (這會觸發所有隱藏的 Triggers)
        const visiblePathsMap = getVisibleSpecsTree(
            specDefinitions as any,
            valueProxy as any,
            specTriggers
        );

        const sortedPaths = getTreeSortedVisiblePaths(
            specDefinitions as any,
            visiblePathsMap,
            categorySortMap
        );

        // 4. 映射回顯示格式
        return sortedPaths.map(({ pathKey, level }) => {
            const specId = pathKey.split(':')[1];
            const def = specDefinitions.find((s: any) => s.id === specId);
            if (!def) return null;

            const agg = specIdAgg.get(specId);
            const isHeading = def.type === 'heading';
            const hasValue = agg && agg.rawValues.length > 0;

            // 標題一律顯示；其餘項目若無數據則隱藏
            if (!isHeading && !hasValue) return null;

            return {
                id: pathKey,
                name: def.name,
                value: hasValue ? (agg.rawValues.length > 1 ? agg.rawValues : agg.rawValues[0]) : null,
                level: level,
                isMultiple: hasValue && agg.rawValues.length > 1
            };
        }).filter(Boolean);
    }, [product, variants, selectedVariantId, specDefinitions, specTriggers]);
    // console.log("combinedSpecs", combinedSpecs)
    const currentPriceDisplay = useMemo(() => {
        if (!product) return "$0";
        if (selectedVariant) {
            const price = selectedVariant.effective_wholesale_price ?? selectedVariant.wholesale_price;
            return `$${price}`;
        }
        return calculatePriceRange(product.wholesale_price, product.variants?.map(v => v.effective_wholesale_price) || []).display;
    }, [product, selectedVariant]);

    const qty = (product && selectedVariantId) ? getItemQuantity(selectedVariantId) : (product ? getItemQuantity(product.id) : 0);

    const handleAddProduct = () => {
        if (!product) return;
        if (product.has_variants && !selectedVariantId) {
            toast.error("請先選擇規格");
            return;
        }
        if (selectedVariant) {
            addItem(product, selectedVariant);
            toast.success(`${product.name} (${selectedVariant.name}) 已加入購物車`);
        } else {
            addItem(product);
            toast.success(`${product.name} 已加入購物車`);
        }
    };

    if (!product) return null;
    // console.log("specDefinitions", specDefinitions)
    // console.log("specTriggers", specTriggers)
    // console.log("product", product)
    // console.log("combinedSpecs", combinedSpecs)
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle className="text-xl">{product.name}</DialogTitle>
                    <DialogDescription className="font-mono text-sm">
                        SKU: {product.sku}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                    <div className="aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden border">
                        <div className="flex flex-col items-center text-muted-foreground">
                            <ImageIcon className="h-12 w-12 mb-2" />
                            <span className="text-xs">尚無圖片</span>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">價格</h3>
                            <div className="text-2xl font-bold text-primary mt-1">{currentPriceDisplay}</div>
                        </div>

                        {(product.brand_id || product.model) && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">品牌 / 型號</h3>
                                <p className="mt-1">{getBrandName(product.brand_id)} / {product.model || '-'}</p>
                            </div>
                        )}

                        {((product as any).category_names?.length > 0) && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">類別</h3>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {(product as any).category_names.map((name: string) => (
                                        <Badge key={name} variant="secondary">{name}</Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="pt-4 border-t">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">產品描述</h3>
                            <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                                {product.description || "尚無詳細描述。"}
                            </div>
                        </div>

                        {effectiveModels.length > 0 && (
                            <div className="pt-4 border-t">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">適用型號</h3>
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                    {effectiveModels.map((name: string) => (
                                        <Badge key={name} variant="secondary" className="text-[11px] font-normal px-2 py-0.5 bg-blue-50 text-blue-700 border-blue-100">
                                            {name}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        {combinedSpecs.length > 0 && (
                            <div className="pt-4 border-t">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">產品規格</h3>
                                <div className="space-y-0.5">
                                    {combinedSpecs.map((spec) => {
                                        const parts = spec.id.split(':');
                                        const specId = parts.length >= 2 ? parts[1] : spec.id;
                                        const def = specDefinitions.find((s: any) => s.id === specId);
                                        const isHeading = def?.type === 'heading' && !spec.value;

                                        if (isHeading) {
                                            return (
                                                <div key={spec.id} className={cn(
                                                    "pt-4 pb-1 border-b border-primary/10",
                                                    spec.level > 0 && "ml-4"
                                                )}>
                                                    <h4 className="text-[10px] font-bold text-primary/70 uppercase tracking-widest flex items-center gap-2">
                                                        {spec.level > 0 && <span className="opacity-30">└─</span>}
                                                        {spec.name}
                                                    </h4>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div key={spec.id} className={cn(
                                                "flex flex-col text-sm py-2 border-b last:border-0 border-muted/30",
                                                spec.level > 0 && "bg-slate-50/30"
                                            )}>
                                                <div className="flex justify-between items-start w-full gap-4">
                                                    <span
                                                        className={cn(
                                                            "text-muted-foreground shrink-0 transition-all",
                                                            spec.level > 0 ? "text-xs flex items-center gap-1.5" : "font-medium"
                                                        )}
                                                        style={{ paddingLeft: `${spec.level * 16}px` }}
                                                    >
                                                        {spec.level > 0 && <span className="opacity-40 text-[10px]">└─</span>}
                                                        {spec.name}
                                                    </span>
                                                    <span className="font-semibold text-right text-slate-700">
                                                        {formatSpecValue(spec.value, def, specDefinitions as any)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="pt-6">
                            {selectedVariant && (
                                <div className="mb-4 p-3 bg-primary/5 border border-primary/20 rounded-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">已選定規格</p>
                                    <p className="text-sm font-semibold text-foreground leading-snug">{selectedVariant.name}</p>
                                </div>
                            )}
                            <Button onClick={handleAddProduct} className="w-full" disabled={product.has_variants && !selectedVariantId}>
                                <ShoppingCart className="mr-2 h-4 w-4" />
                                {product.has_variants && !selectedVariantId ? "請先選擇規格選項" : `加入購物車 ${qty > 0 ? `(已選 ${qty})` : ''}`}
                            </Button>
                        </div>
                    </div>
                </div>

                {product.has_variants && variants.length > 0 && (
                    <div className="mt-6 border-t pt-4 space-y-6">
                        {optionDimensions.map(([dimKey, values]) => (
                            <div key={dimKey as string} className="space-y-3">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                                    {dimKey === 'modelDisplay' ? '型號 / 名稱' :
                                        dimKey === 'option_1' ? '規格 / 屬性' :
                                            dimKey === 'option_2' ? '類型 / 附加規格' :
                                                dimKey === 'option_3' ? '顏色 / 樣式' : '規格選項'}
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {(values as string[]).map((val: string) => {
                                        const isSelected = selectedOptions[dimKey as string] === val;
                                        const isAvailable = isOptionAvailable(dimKey as string, val);
                                        return (
                                            <Badge
                                                key={val}
                                                variant={isSelected ? "default" : "outline"}
                                                className={cn(
                                                    "px-3 py-1.5 cursor-pointer transition-all text-sm flex items-center gap-2",
                                                    !isSelected && !isAvailable && "opacity-30 grayscale cursor-not-allowed pointer-events-none",
                                                    isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                                                )}
                                                onClick={() => isAvailable && handleOptionClick(dimKey as string, val)}
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
                )}
            </DialogContent>
        </Dialog>
    );
}
