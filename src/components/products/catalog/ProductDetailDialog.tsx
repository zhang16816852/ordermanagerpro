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
import { Checkbox } from "@/components/ui/checkbox";
import { ProductWithPricing } from "@/types/product";
import { useStoreDraft } from "@/store/useOrderDraftStore";
import { toast } from "sonner";
import { ShoppingCart } from "lucide-react";
import { useSpecStore } from "@/store/useSpecStore";
import { supabase } from "@/integrations/supabase/client";
import { CacheService, CACHE, ONE_YEAR_MS } from "@/services/cacheService";
import { formatSpecValue, getTreeSortedVisiblePaths, getVisibleSpecsTree } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";
import { calculatePriceRange } from "@/utils/priceUtils";
import { ImageGallery } from "@/components/products/catalog/ImageGallery";
import { ProductVariantSection } from "@/components/products/catalog/ProductVariantSection";
import type { ProductImage } from "@/components/products/images/ProductImageManager";
import type { OrderGridTemplateWithProducts } from "@/types/order-grid";

interface ProductDetailDialogProps {
    product: ProductWithPricing | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    storeId: string;
    templates?: OrderGridTemplateWithProducts[];
}

const SHOW_IMAGES_KEY = "product_detail_show_images";

function getShowImagesDefault(): boolean {
    try {
        return localStorage.getItem(SHOW_IMAGES_KEY) === "true";
    } catch {
        return false;
    }
}

export function ProductDetailDialog({
    product,
    open,
    onOpenChange,
    storeId,
    templates,
}: ProductDetailDialogProps) {
    const { addItem, getItemQuantity } = useStoreDraft(storeId);
    const { getBrandName } = useBrands();
    const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
    const [pickerOptions, setPickerOptions] = useState<Record<string, string | null> | null>(null);
    const [showImages, setShowImages] = useState(getShowImagesDefault);

    const [productImages, setProductImages] = useState<ProductImage[]>([]);
    const [variantImageMap, setVariantImageMap] = useState<Map<string, ProductImage[]>>(new Map());

    useEffect(() => {
        if (!open || !product) {
            setProductImages([]);
            setVariantImageMap(new Map());
            return;
        }

        const cacheKey = `product_images_${product.id}`;
        const cached = CacheService.get<{
            productImages: ProductImage[];
            variantEntries: [string, ProductImage[]][];
        }>(cacheKey, CACHE.productImages.schema, ONE_YEAR_MS);

        if (cached.exists && cached.data) {
            setProductImages(cached.data.productImages);
            setVariantImageMap(new Map(cached.data.variantEntries));
            return;
        }

        const entityIds = [product.id, ...(product.variants?.map(v => v.id) || [])] as string[];
        (supabase
            .from('product_images' as any)
            .select('*') as any)
            .in('entity_id', entityIds as any)
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

                CacheService.set(cacheKey, {
                    productImages: pImgs,
                    variantEntries: Array.from(vMap.entries()),
                }, '1', CACHE.productImages.schema);
            });
    }, [open, product]);

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

    const handleOptionsChange = useCallback((options: Record<string, string | null>) => {
        setPickerOptions(options);
    }, []);

    const toggleShowImages = (checked: boolean) => {
        setShowImages(checked);
        try { localStorage.setItem(SHOW_IMAGES_KEY, String(checked)); } catch {}
    };

    useEffect(() => {
        if (!open) {
            setSelectedVariantId(null);
            setPickerOptions(null);
        }
    }, [open, product?.id]);

    const { specDefinitions, specTriggers, categoryLinks, fetchSpecs } = useSpecStore();

    useEffect(() => {
        if (open && (specDefinitions.length === 0 || categoryLinks.length === 0)) {
            fetchSpecs();
        }
    }, [open, specDefinitions.length, categoryLinks.length, fetchSpecs]);

    const selectedVariant = useMemo(() => {
        if (!selectedVariantId || !product?.variants) return null;
        return product.variants.find((v: any) => v.id === selectedVariantId) || null;
    }, [product?.variants, selectedVariantId]);

    const effectiveModels = useMemo(() => {
        if (!product) return [];

        const results: any[] = [];
        const seenIds = new Set<string>();

        const addModels = (target: any) => {
            ((target as any).device_models || []).forEach((m: any) => {
                const name = typeof m === 'string' ? m : m?.name;
                if (!name || seenIds.has(name)) return;
                seenIds.add(name);
                results.push({ model_id: m?.id || name, model_name: name, source: 'direct' });
            });

            ((target as any).device_model_groups || []).forEach((g: any) => {
                const name = typeof g === 'string' ? g : g?.name;
                if (!name || seenIds.has(name)) return;
                seenIds.add(name);
                results.push({ model_id: g?.id || name, model_name: name, source: 'group', items: g?.items || [] });
            });
        };

        if (selectedVariant) {
            addModels(selectedVariant);
        } else if (pickerOptions && Object.values(pickerOptions).some(v => v !== null)) {
            const opts = pickerOptions;
            const matchedVariants = (product.variants || []).filter((v: any) => {
                const mModel = !opts.modelDisplay || v.modelDisplay === opts.modelDisplay;
                const mO1 = !opts.option_1 || v.option_1 === opts.option_1;
                const mO2 = !opts.option_2 || v.option_2 === opts.option_2;
                const mO3 = !opts.option_3 || v.option_3 === opts.option_3;
                return mModel && mO1 && mO2 && mO3;
            });
            matchedVariants.forEach((v: any) => addModels(v));
        } else {
            addModels(product);
            (product.variants || []).forEach((v: any) => addModels(v));
        }

        return results;
    }, [product, selectedVariant, pickerOptions]);

    const variants = product?.variants || [];

    const combinedSpecs = useMemo(() => {
        if (!product || specDefinitions.length === 0) return [];

        const productCategoryIds = (product as any).category_ids || [];
        const categorySortMap: Record<string, number> = {};

        categoryLinks
            .filter(link => productCategoryIds.includes(link.category_id))
            .forEach(link => {
                if (categorySortMap[link.spec_id] === undefined || link.sort_order < categorySortMap[link.spec_id]) {
                    categorySortMap[link.spec_id] = link.sort_order;
                }
            });

        const specIdAgg = new Map<string, { rawValues: any[], stringifiedSet: Set<string> }>();
        const addValue = (pathKey: string, val: any) => {
            if (val === null || val === undefined || val === '') return;
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

        if (product.spec_values) Object.entries(product.spec_values).forEach(([k, v]) => addValue(k, v));
        const vList = selectedVariantId ? variants.filter((v: any) => v.id === selectedVariantId) : variants;
        vList.forEach((v: any) => {
            if (v.spec_values) Object.entries(v.spec_values).forEach(([k, val]) => addValue(k, val));
        });

        const flattenedValues: Record<string, any> = {};
        specIdAgg.forEach((agg, specId) => { flattenedValues[specId] = agg.rawValues[0]; });

        const valueProxy = new Proxy(flattenedValues, {
            get: (target, prop: string) => {
                if (typeof prop !== 'string') return undefined;
                const sid = prop.includes(':') ? prop.split(':')[1] : prop;
                return target[sid];
            }
        });

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
        return calculatePriceRange(product.wholesale_price, product.variants?.map((v: any) => v.effective_wholesale_price) || []).display;
    }, [product, selectedVariant]);

    const qty = (product && selectedVariantId) ? getItemQuantity(product.id, selectedVariantId) : (product ? getItemQuantity(product.id) : 0);

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

                <div className="flex items-center gap-2 pt-1 pb-2">
                    <Checkbox
                        id="show-images"
                        checked={showImages}
                        onCheckedChange={(checked) => toggleShowImages(checked === true)}
                    />
                    <label htmlFor="show-images" className="text-xs text-muted-foreground cursor-pointer select-none">
                        顯示圖片
                    </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
                    {showImages && (
                        <ImageGallery
                            images={displayImages}
                            coverUrl={(product as any).image_url}
                        />
                    )}

                    <div className={cn("space-y-4", !showImages && "md:col-span-2")}>
                        <div>
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">價格</h3>
                            <div className="text-2xl font-bold text-primary mt-1">{currentPriceDisplay}</div>
                        </div>

                        {((product as any).brand_ids?.length > 0 || product.model) && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">品牌 / 型號</h3>
                                <p className="mt-1">{(product as any).primary_brand_name || ((product as any).brand_names?.join(', ') || '-')} / {product.model || '-'}</p>
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
                                    {combinedSpecs.map((spec: any) => {
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
                                                        {spec.isMultiple && Array.isArray(spec.value)
                                                            ? spec.value.map((v: any) => formatSpecValue(v, def, specDefinitions as any)).filter(Boolean).join(' / ')
                                                            : formatSpecValue(spec.value, def, specDefinitions as any)
                                                        }
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="pt-6 space-y-3">
                            {selectedVariant && (
                                <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">已選定規格</p>
                                    <p className="text-sm font-semibold text-foreground leading-snug">{selectedVariant.name}</p>
                                </div>
                            )}

                            <Button
                                onClick={handleAddProduct}
                                className="w-full"
                                variant={qty > 0 ? "secondary" : "default"}
                                disabled={product.has_variants && !selectedVariantId}
                            >
                                <ShoppingCart className="mr-2 h-4 w-4" />
                                {product.has_variants && !selectedVariantId
                                    ? "請先選擇規格選項"
                                    : qty > 0
                                        ? `已在購物車中 (x${qty})`
                                        : "加入購物車"}
                            </Button>
                        </div>
                    </div>
                </div>

                {product.has_variants && (
                    <ProductVariantSection
                        product={product}
                        storeId={storeId}
                        onVariantSelect={handleVariantSelect}
                        onSelectionChange={handleOptionsChange}
                        templates={templates}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
