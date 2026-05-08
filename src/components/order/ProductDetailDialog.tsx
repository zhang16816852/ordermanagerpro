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
import { useQuery } from "@tanstack/react-query";
import { useSpecStore } from "@/store/useSpecStore";
import { supabase } from "@/integrations/supabase/client";
import { formatSpecValue, deserializeSpecs, getTreeSortedVisiblePaths } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";
import { calculatePriceRange } from "@/utils/priceUtils";
import { useProductColors } from "@/hooks/useProductColors";
import { getContrastColor } from "@/utils/colorUtils";

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

    // 當彈窗開啟或產品改變時，若產品有變體，預設不選中或由外部決定
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

    // 獲取目前選中的變體物件
    const selectedVariant = useMemo(() => {
        if (!selectedVariantId || !product?.variants) return null;
        return product.variants.find(v => v.id === selectedVariantId) || null;
    }, [product?.variants, selectedVariantId]);

    const { specDefinitions, specTriggers, fetchSpecs } = useSpecStore();

    useEffect(() => {
        if (open && specDefinitions.length === 0) {
            fetchSpecs();
        }
    }, [open, specDefinitions.length, fetchSpecs]);

    // Resolve effective models from cache
    const effectiveModels = useMemo(() => {
        const target = selectedVariant || product;
        if (!target) return [];
        return (target as any).effective_model_names || [];
    }, [product, selectedVariant]);

    // --- 變體矩陣邏輯 ---
    // 預處理變體，產生乾淨的型號顯示名稱
    const processedVariants = useMemo(() => {
        if (!product?.variants) return [];
        return product.variants.map(v => {
            const groupNames = (v as any).variant_model_group_links?.map((l: any) => l.device_model_groups?.name).filter(Boolean) || [];
            const modelNames = (v as any).variant_model_links?.map((l: any) => l.device_models?.name).filter(Boolean) || [];

            let modelDisplay = '';
            if (groupNames.length > 0) modelDisplay = groupNames.join(', ');
            else if (modelNames.length > 0) modelDisplay = modelNames.join(', ');
            else {
                // 如果沒有結構化的型號連結，僅在沒有其他選項時才將名稱作為維度
                // 這樣可以防止在已有 option_1/2/3 的情況下出現冗餘的長名稱
                const hasOptions = !!(v.option_1 || v.option_2 || v.option_3);
                modelDisplay = hasOptions ? '' : v.name;
            }

            return { ...v, modelDisplay };
        });
    }, [product?.variants]);

    const variants = processedVariants;

    // Extract unique options for each category
    const optionDimensions = useMemo(() => {
        const dims: { [key: string]: string[] } = {
            option_1: [],
            option_2: [],
            option_3: []
        };

        variants.forEach(v => {
            if (v.option_1) if (!dims.option_1.includes(v.option_1)) dims.option_1.push(v.option_1);
            if (v.option_2) if (!dims.option_2.includes(v.option_2)) dims.option_2.push(v.option_2);
            if (v.option_3) if (!dims.option_3.includes(v.option_3)) dims.option_3.push(v.option_3);
        });

        const filteredDims = Object.entries(dims).filter(([_, values]) => values.length > 0);

        // Always include 'modelDisplay' as the primary dimension (Model) if it contains non-empty values
        const modelNames = Array.from(new Set(variants.map(v => v.modelDisplay))).filter(Boolean);
        if (modelNames.length > 0) {
            return [['modelDisplay', modelNames], ...filteredDims] as [string, string[]][];
        }

        return filteredDims as [string, string[]][];
    }, [variants, product?.name]);

    // Helper to check if an option combination is available
    const isOptionAvailable = useCallback((dimKey: string, value: string) => {
        const testOptions = { ...selectedOptions, [dimKey]: value };
        return variants.some(v => {
            const matchModel = !testOptions.modelDisplay || v.modelDisplay === testOptions.modelDisplay;
            const matchO1 = !testOptions.option_1 || v.option_1 === testOptions.option_1;
            const matchO2 = !testOptions.option_2 || v.option_2 === testOptions.option_2;
            const matchO3 = !testOptions.option_3 || v.option_3 === testOptions.option_3;
            return matchModel && matchO1 && matchO2 && matchO3;
        });
    }, [variants, selectedOptions]);

    // Effect to auto-select variant when options match exactly
    useEffect(() => {
        if (!product?.has_variants) return;

        const match = variants.find(v => {
            // 正規化 '' 和 null 以便進行比較
            const vModel = v.modelDisplay || null;
            const sModel = selectedOptions.modelDisplay || null;

            return vModel === sModel &&
                v.option_1 === selectedOptions.option_1 &&
                v.option_2 === selectedOptions.option_2 &&
                v.option_3 === selectedOptions.option_3;
        });

        if (match) {
            setSelectedVariantId(match.id);
        } else {
            // 如果沒有完全匹配，可能是尚未選擇所有維度
            setSelectedVariantId(null);
        }
    }, [selectedOptions, variants, product?.has_variants]);

    // 處理選項點擊
    const handleOptionClick = (dimKey: string, value: string) => {
        setSelectedOptions(prev => ({
            ...prev,
            [dimKey]: prev[dimKey] === value ? null : value
        }));
    };

    // --- 核心邏輯：深度彙整與樹狀排序 ---
    const combinedSpecs = useMemo(() => {
        if (!product) return [];
        if (specDefinitions.length === 0) {
            console.log('[DetailDialog] 規格定義尚未載入');
            return [];
        }

        console.log('[DetailDialog] 原始產品規格:', product.spec_values);
        console.log('[DetailDialog] 變體數量:', product.variants?.length);

        // 1. 建立一個 Map 來存放每一個 pathKey 對應到的所有唯一數值
        // 使用 JSON.stringify(val) 作為 Set 的判斷依據，以處理物件型規格
        const specsAggregation = new Map<string, { rawValues: any[], stringifiedSet: Set<string> }>();

        const addValueToAgg = (pathKey: string, val: any) => {
            if (val === null || val === undefined || val === '') return;
            if (!specsAggregation.has(pathKey)) {
                specsAggregation.set(pathKey, { rawValues: [], stringifiedSet: new Set() });
            }
            const agg = specsAggregation.get(pathKey)!;

            // 處理物件 Key 排序，確保 {"a":1, "b":2} 等於 {"b":2, "a":1}
            let sVal;
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                const sortedObj = Object.keys(val).sort().reduce((acc: any, k) => {
                    acc[k] = val[k];
                    return acc;
                }, {});
                sVal = JSON.stringify(sortedObj);
            } else {
                sVal = JSON.stringify(val);
            }

            if (!agg.stringifiedSet.has(sVal)) {
                agg.stringifiedSet.add(sVal);
                agg.rawValues.push(val);
            }
        };

        // 2. 搜集數據：從產品本身與所有變體中提取規格
        // 產品層級規格
        if (product.spec_values) {
            Object.entries(product.spec_values).forEach(([pathKey, val]) => {
                addValueToAgg(pathKey, val);
            });
        }

        // 變體層級規格 (僅在沒有選定特定變體時進行聚合顯示)
        // 收集變體規格
        const vList = selectedVariantId ? variants.filter(v => v.id === selectedVariantId) : variants;
        console.log('[DetailDialog] 準備處理的變體數:', vList.length);
        console.log(vList)
        vList.forEach(v => {
            if (v.spec_values) {
                Object.entries(v.spec_values).forEach(([k, val]) => addValueToAgg(k, val));
            }
        });

        console.log('[DetailDialog] 聚合後的 Map 大小:', specsAggregation.size);

        // 3. 準備給排序演算法的 Map (基於當前已有的聚合數值)
        const visibleInfo = new Map<string, any>();
        specsAggregation.forEach((_, key) => visibleInfo.set(key, {}));

        // 4. 執行樹狀排序 (DFS)
        const sortedPaths = getTreeSortedVisiblePaths(specDefinitions as any, visibleInfo);

        // 5. 轉換為最終顯示格式
        return sortedPaths.map(({ pathKey, level }) => {
            const agg = specsAggregation.get(pathKey);
            if (!agg) return null;

            const parts = pathKey.split(':');
            const specId = parts[1];
            const instanceUuid = parts[2];
            const def = specDefinitions.find((s: any) => s.id === specId);

            // 如果找不到定義，嘗試從資料中找 (僅限相容性用途)
            let displayName = def?.name;
            if (!displayName && product.variants) {
                for (const v of product.variants) {
                    const specs = v.spec_values;
                    if (Array.isArray(specs)) {
                        const entry = (specs as any[]).find(e => (e.spec_id || e.id) === specId);
                        if (entry?.path) {
                            displayName = entry.path.split(' > ').pop();
                            break;
                        }
                    }
                }
            }

            // 最後還是找不到，才顯示 ID (但去掉 root: 前綴)
            if (!displayName) {
                displayName = pathKey.startsWith('root:') ? pathKey.replace('root:', '') : pathKey;
            }

            // 由於已經過深度比對，rawValues.length 就是唯一值的數量
            const isConstant = agg.rawValues.length === 1;

            return {
                id: pathKey,
                name: displayName,
                value: isConstant ? agg.rawValues[0] : '多種型號可供選擇',
                isMultiple: !isConstant,
                level: level
            };
        }).filter(Boolean) as any[];
    }, [product, specDefinitions]);
    console.log("文字規格:", combinedSpecs)
    // 獲取目前應顯示的價格
    const currentPriceDisplay = useMemo(() => {
        if (!product) return "$0";
        // 如果有選中變體，顯示該變體的價格
        if (selectedVariant) {
            const price = selectedVariant.effective_wholesale_price ?? selectedVariant.wholesale_price;
            return `$${price}`;
        }
        // 否則顯示產品的價格區間
        return calculatePriceRange(product.wholesale_price, product.variants?.map(v => v.effective_wholesale_price) || []).display;
    }, [product, selectedVariant]);

    const qty = (product && selectedVariantId) ? getItemQuantity(selectedVariantId) : (product ? getItemQuantity(product.id) : 0);

    if (!product) return null;

    const handleAddProduct = () => {
        if (!product) return;
        if (product.has_variants && !selectedVariantId) {
            toast.error("請先選擇規格");
            return;
        }

        if (selectedVariant) {
            addItem({
                ...product,
                id: selectedVariant.id,
                name: `${product.name} (${selectedVariant.name})`,
                wholesale_price: selectedVariant.effective_wholesale_price ?? selectedVariant.wholesale_price,
                retail_price: selectedVariant.effective_retail_price ?? selectedVariant.retail_price,
            } as any);
            toast.success(`${product.name} (${selectedVariant.name}) 已加入購物車`);
        } else {
            addItem(product);
            toast.success(`${product.name} 已加入購物車`);
        }
    };

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
                            <div className="text-2xl font-bold text-primary mt-1">
                                {currentPriceDisplay}
                            </div>
                        </div>

                        {(product.brand_id || product.model) && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">品牌 / 型號</h3>
                                <p className="mt-1">
                                    {getBrandName(product.brand_id)} / {product.model || '-'}
                                </p>
                            </div>
                        )}
                        {((product as any).category_names?.length > 0) && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">類別</h3>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {(product as any).category_names.map((name: string) => (
                                        <Badge key={name} variant="secondary">
                                            {name}
                                        </Badge>
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
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                    適用型號 {selectedVariantId && <Badge variant="outline" className="ml-2 text-[10px] font-normal py-0">規格專屬</Badge>}
                                </h3>
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                    {effectiveModels.map((name: string) => (
                                        <Badge
                                            key={name}
                                            variant="secondary"
                                            className="text-[11px] font-normal px-2 py-0.5 bg-blue-50 text-blue-700 border-blue-100"
                                        >
                                            {name}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        {combinedSpecs.length > 0 && (
                            <div className="pt-4 border-t">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">產品規格</h3>
                                <div className="space-y-2">
                                    {combinedSpecs.map((spec) => {
                                        const specId = spec.id.split(':').pop();
                                        const def = specDefinitions.find((s: any) => s.id === specId);

                                        if (def?.type === 'heading') {
                                            return (
                                                <div key={spec.id} className="pt-4 pb-1 border-b border-primary/10">
                                                    <h4 className="text-xs font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                                                        <span className="w-1 h-3 bg-primary rounded-full" />
                                                        {spec.name}
                                                    </h4>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div key={spec.id} className="flex flex-col text-sm py-2 border-b last:border-0 border-muted">
                                                <div className="flex justify-between items-start w-full gap-4">
                                                    <span
                                                        className={cn(
                                                            "text-muted-foreground transition-all duration-200 shrink-0",
                                                            spec.level > 0 && "pl-4 text-xs flex items-center gap-1"
                                                        )}
                                                    >
                                                        {spec.level > 0 && <span className="opacity-50 text-[10px]">└─</span>}
                                                        {spec.name}
                                                    </span>
                                                    <span className={cn(
                                                        "font-medium text-right transition-all duration-200",
                                                        (spec as any).isMultiple && "text-muted-foreground/40 italic font-normal"
                                                    )}>
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
                                    <div className="flex justify-between items-start mb-1">
                                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">已選定規格</p>
                                    </div>
                                    <p className="text-sm font-semibold text-foreground leading-snug">
                                        {selectedVariant.name}
                                    </p>
                                </div>
                            )}
                            <Button
                                onClick={handleAddProduct}
                                className="w-full"
                                disabled={product.has_variants && !selectedVariantId}
                            >
                                <ShoppingCart className="mr-2 h-4 w-4" />
                                {product.has_variants && !selectedVariantId
                                    ? "請先選擇規格選項"
                                    : `加入購物車 ${qty > 0 ? `(已選 ${qty})` : ''}`}
                            </Button>
                        </div>
                    </div>
                </div>

                {product.has_variants && variants.length > 0 && (
                    <div className="mt-6 border-t pt-4 space-y-6">
                        {optionDimensions.map(([dimKey, values], idx) => (
                            <div key={dimKey as string} className="space-y-3">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                                    {/* Try to guess label or use generic */}
                                    {dimKey === 'modelDisplay' ? '型號 / 名稱' :
                                        dimKey === 'option_1' ? '規格 / 屬性' :
                                            dimKey === 'option_2' ? '類型 / 附加規格' :
                                                dimKey === 'option_3' ? '顏色 / 樣式' : '規格選項'}
                                    {selectedOptions[dimKey as string] && (
                                        <Badge variant="outline" className="text-[10px] py-0 font-normal border-primary/30 text-primary">
                                            已選: {selectedOptions[dimKey as string]}
                                        </Badge>
                                    )}
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
                                                    !isSelected && isAvailable && "hover:bg-primary/10 border-primary/20",
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
