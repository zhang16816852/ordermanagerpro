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
import { ShoppingCart, ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { useSpecStore } from "@/store/useSpecStore";
import { supabase } from "@/integrations/supabase/client";
import { formatSpecValue, deserializeSpecs, getTreeSortedVisiblePaths, getVisibleSpecsTree } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";
import { calculatePriceRange } from "@/utils/priceUtils";
import { VariantOptionsPicker } from "./VariantOptionsPicker";
import { useProductColors } from "@/hooks/useProductColors";
import type { ProductImage } from "@/components/products/images/ProductImageManager";

interface ProductDetailDialogProps {
    product: ProductWithPricing | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    storeId: string;
}

// =============================================
// 圖片輪播子元件
// =============================================
function ImageGallery({ images, coverUrl }: { images: ProductImage[], coverUrl?: string | null }) {
    const [activeIndex, setActiveIndex] = useState(0);

    const allImages = useMemo(() => {
        if (images.length > 0) return images;
        // 若無圖片但有封面 URL（來自快取），產生一個虛擬項目
        if (coverUrl) return [{ id: 'cover', url: coverUrl } as unknown as ProductImage];
        return [];
    }, [images, coverUrl]);

    useEffect(() => { setActiveIndex(0); }, [allImages]);

    if (allImages.length === 0) {
        return (
            <div className="aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden border">
                <div className="flex flex-col items-center text-muted-foreground">
                    <ImageIcon className="h-12 w-12 mb-2" />
                    <span className="text-xs">尚無圖片</span>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {/* 主圖 */}
            <div className="aspect-square bg-muted rounded-lg overflow-hidden border relative group">
                <img
                    src={allImages[activeIndex]?.url}
                    alt="產品圖片"
                    className="w-full h-full object-cover"
                />
                {allImages.length > 1 && (
                    <>
                        <button
                            className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => setActiveIndex(i => (i - 1 + allImages.length) % allImages.length)}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                            className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => setActiveIndex(i => (i + 1) % allImages.length)}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                            {allImages.map((_, i) => (
                                <div
                                    key={i}
                                    className={cn('h-1.5 rounded-full transition-all', i === activeIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/50')}
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* 縮圖列（超過 1 張才顯示）*/}
            {allImages.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {allImages.map((img, i) => (
                        <div
                            key={img.id}
                            className={cn(
                                'w-14 h-14 flex-shrink-0 rounded overflow-hidden border-2 cursor-pointer transition-all',
                                i === activeIndex ? 'border-primary' : 'border-transparent hover:border-muted-foreground/40'
                            )}
                            onClick={() => setActiveIndex(i)}
                        >
                            <img src={img.url} alt="" className="w-full h-full object-cover" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
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

    // 抓取圖片
    const [productImages, setProductImages] = useState<ProductImage[]>([]);
    const [variantImageMap, setVariantImageMap] = useState<Map<string, ProductImage[]>>(new Map());

    useEffect(() => {
        if (!open || !product) {
            setProductImages([]);
            setVariantImageMap(new Map());
            return;
        }
        // 抓取此主商品 + 所有變體的圖片
        const entityIds = [product.id, ...(product.variants?.map(v => v.id) || [])];
        supabase
            .from('product_images')
            .select('*')
            .in('entity_id', entityIds)
            .order('sort_order', { ascending: true })
            .then(({ data }) => {
                if (!data) return;

                const typedData = data as unknown as ProductImage[];

                const pImgs = typedData.filter(img => img.entity_id === product.id && img.entity_type === 'product');
                setProductImages(pImgs);

                const vMap = new Map<string, ProductImage[]>();
                typedData
                    .filter(img => img.entity_type === 'variant')
                    .forEach(img => {
                        if (!vMap.has(img.entity_id)) vMap.set(img.entity_id, []);
                        vMap.get(img.entity_id)!.push(img);
                    });
                setVariantImageMap(vMap);
            });
    }, [open, product]);

    // 決定目前顯示的圖片（選了變體就用變體圖，否則用主商品圖）
    const displayImages = useMemo(() => {
        if (selectedVariantId) {
            const vImgs = variantImageMap.get(selectedVariantId);
            if (vImgs && vImgs.length > 0) return vImgs;
        }
        return productImages;
    }, [selectedVariantId, productImages, variantImageMap]);

    const handleVariantSelect = useCallback((v: any | null) => {
        setSelectedVariantId(v?.id || null);
    }, []);

    useEffect(() => {
        if (!open) {
            setSelectedVariantId(null);
        }
    }, [open, product?.id]);

    const { specDefinitions, specTriggers, categoryLinks, fetchSpecs } = useSpecStore();

    useEffect(() => {
        if (open && specDefinitions.length === 0) {
            fetchSpecs();
        }
    }, [open, specDefinitions.length, fetchSpecs]);

    const selectedVariant = useMemo(() => {
        if (!selectedVariantId || !product?.variants) return null;
        return product.variants.find(v => v.id === selectedVariantId) || null;
    }, [product?.variants, selectedVariantId]);

    const effectiveModels = useMemo(() => {
        if (!product) return [];

        const results: any[] = [];
        const seenIds = new Set<string>();

        const addModels = (target: any) => {
            // 直接關聯 (琥珀色)
            ((target as any).device_models || []).forEach((m: any) => {
                const name = typeof m === 'string' ? m : m?.name;
                if (!name || seenIds.has(name)) return;
                seenIds.add(name);
                results.push({ model_id: m?.id || name, model_name: name, source: 'direct' });
            });

            // 群組關聯 (藍色)
            ((target as any).device_model_groups || []).forEach((g: any) => {
                const name = typeof g === 'string' ? g : g?.name;
                if (!name || seenIds.has(name)) return;
                seenIds.add(name);
                results.push({ model_id: g?.id || name, model_name: name, source: 'group', items: g?.items || [] });
            });
        };

        if (selectedVariant) {
            // 已選取變體 → 只顯示該變體的型號
            addModels(selectedVariant);
        } else {
            // 未選取變體 → 先從主商品收集，再從所有變體收集聯集
            addModels(product);
            (product.variants || []).forEach((v: any) => addModels(v));
        }

        return results;
    }, [product, selectedVariant]);

    const variants = product?.variants || [];

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

            const isLinkedToCategory = categorySortMap[specId] !== undefined;

            if (isHeading) {
                const hasVisibleChildrenWithValues = Array.from(specIdAgg.keys()).some(sid => {
                    const childDef = specDefinitions.find((s: any) => s.id === sid);
                    return childDef?.parent_id === specId && specIdAgg.get(sid)?.rawValues.length! > 0;
                });

                if (!isLinkedToCategory && !hasVisibleChildrenWithValues) return null;
            } else {
                if (!hasValue) return null;
            }

            return {
                id: pathKey,
                name: def.name,
                value: hasValue ? (agg.rawValues.length > 1 ? agg.rawValues : agg.rawValues[0]) : null,
                level: level,
                isMultiple: hasValue && agg.rawValues.length > 1
            };
        }).filter(Boolean);
    }, [product, variants, selectedVariantId, specDefinitions, specTriggers]);

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
                    {/* 圖片輪播區域 */}
                    <ImageGallery
                        images={displayImages}
                        coverUrl={(product as any).image_url}
                    />

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
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                    適用型號 {selectedVariantId && <Badge variant="outline" className="ml-2 text-[10px] font-normal py-0">規格專屬</Badge>}
                                </h3>
                                <div className="flex flex-wrap gap-2 mt-1">
                                    {effectiveModels.map((m: any) => (
                                        <div key={m.model_id} className={cn(
                                            "flex items-center gap-1.5 border rounded-full px-2 py-0.5",
                                            m.source === 'direct' ? "bg-amber-50/50 border-amber-200" : "bg-blue-50/50 border-blue-200"
                                        )}>
                                            <span className={cn("text-[11px] font-medium", m.source === 'direct' ? "text-amber-700" : "text-blue-700")}>
                                                {m.model_name}
                                            </span>
                                            {m.source === 'group' && m.items && m.items.length > 0 && (
                                                <>
                                                    <span className="text-[10px] text-muted-foreground/40">|</span>
                                                    <div className="flex items-center gap-1">
                                                        {m.items.map((item: any, idx: number) => (
                                                            <span key={item.id} className="text-[10px] text-muted-foreground">
                                                                {item.name}{idx < m.items.length - 1 ? ',' : ''}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </>
                                            )}
                                        </div>
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

                {product.has_variants && (
                    <div className="mt-6 border-t pt-4 space-y-6">
                        <VariantOptionsPicker
                            product={product}
                            onVariantSelect={handleVariantSelect}
                        />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
