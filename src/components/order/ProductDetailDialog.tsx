import { useState, useMemo, useEffect } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { formatSpecValue, deserializeSpecs, getTreeSortedVisiblePaths } from "@/utils/specLogic";
import { useBrands } from "@/hooks/useBrands";
import { calculatePriceRange } from "@/utils/priceUtils";

interface ProductDetailDialogProps {
    product: ProductWithPricing | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    storeId: string;
}

/**
 * v4.11 表格型規格顯示組件
 */
function SpecTableDisplay({ value, columns }: { value: any[], columns: any[] }) {
    if (!Array.isArray(value) || value.length === 0) return null;
    return (
        <div className="mt-1.5 border rounded-md overflow-hidden bg-background/50 shadow-sm w-full">
            <table className="w-full text-[10px] border-collapse">
                <thead className="bg-muted/50 border-b">
                    <tr>
                        {columns.map(col => (
                            <th key={col.id || col.name} className="px-2 py-1.5 text-left font-bold text-muted-foreground border-r last:border-r-0 uppercase tracking-tighter">
                                {col.name}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-muted/30">
                    {value.map((row, i) => (
                        <tr key={i} className="hover:bg-muted/20 transition-colors">
                            {columns.map(col => {
                                const colKey = col.id || col.name;
                                const cellVal = row[colKey];
                                return (
                                    <td key={colKey} className="px-2 py-1.5 border-r last:border-r-0 align-top">
                                        {Array.isArray(cellVal) ? (
                                            <div className="flex flex-wrap gap-1">
                                                {cellVal.map(v => <Badge key={v} variant="outline" className="text-[8px] px-1 h-3.5 leading-none">{v}</Badge>)}
                                            </div>
                                        ) : String(cellVal || '-')}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function ProductDetailDialog({
    product,
    open,
    onOpenChange,
    storeId,
}: ProductDetailDialogProps) {
    const { addItem, getItemQuantity } = useStoreDraft(storeId);
    const { getBrandName } = useBrands();
    const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

    // 當彈窗開啟或產品改變時，若產品有變體，預設不選中或由外部決定
    useEffect(() => {
        if (!open) setSelectedVariantId(null);
    }, [open]);

    // 獲取目前選中的變體物件
    const selectedVariant = useMemo(() => {
        if (!selectedVariantId || !product?.variants) return null;
        return product.variants.find(v => v.id === selectedVariantId) || null;
    }, [product?.variants, selectedVariantId]);

    const { data: specDefinitions = [] } = useQuery({
        queryKey: ['spec_definitions'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('specification_definitions' as any) as any).select('*');
            if (error) return [];
            return data;
        },
    });

    // --- 核心邏輯：深度彙整與樹狀排序 ---
    const combinedSpecs = useMemo(() => {
        if (!product || specDefinitions.length === 0) return [];

        // 1. 建立一個 Map 來存放每一個 pathKey 對應到的所有唯一數值
        // 使用 JSON.stringify(val) 作為 Set 的判斷依據
        const specsAggregation = new Map<string, { rawValues: any[], stringifiedSet: Set<string> }>();
        
        const addValueToAgg = (key: string, val: any) => {
            if (val === null || val === undefined || val === '') return;
            if (!specsAggregation.has(key)) {
                specsAggregation.set(key, { rawValues: [], stringifiedSet: new Set() });
            }
            const agg = specsAggregation.get(key)!;
            
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

        // 2. 搜集數據
        if (selectedVariant) {
            const vSpecs = deserializeSpecs(selectedVariant.table_settings);
            const pSpecs = deserializeSpecs(product.table_settings);
            // 變體模式下：變體存在的 key 會覆蓋產品
            const allKeys = new Set([...Object.keys(pSpecs), ...Object.keys(vSpecs)]);
            allKeys.forEach(key => {
                const val = vSpecs[key] !== undefined ? vSpecs[key] : pSpecs[key];
                addValueToAgg(key, val);
            });
        } else if (product.variants && product.variants.length > 0) {
            // 初始狀態：預覽所有變體的合集
            product.variants.forEach(v => {
                const vSpecs = deserializeSpecs(v.table_settings);
                Object.entries(vSpecs).forEach(([key, val]) => addValueToAgg(key, val));
            });
            // 同時也考慮產品本身的規格 (若有的話)
            const pSpecs = deserializeSpecs(product.table_settings);
            Object.entries(pSpecs).forEach(([key, val]) => addValueToAgg(key, val));
        } else {
            // 單產品模式
            const pSpecs = deserializeSpecs(product.table_settings);
            Object.entries(pSpecs).forEach(([key, val]) => addValueToAgg(key, val));
        }

        // 3. 準備給排序演算法的 Map
        const visibleInfo = new Map<string, any>();
        specsAggregation.forEach((_, key) => visibleInfo.set(key, {}));

        // 4. 執行樹狀排序 (parentId -> id)
        const sortedPaths = getTreeSortedVisiblePaths(specDefinitions, visibleInfo);

        // 5. 轉換為最終顯示格式
        return sortedPaths.map(({ pathKey, level }) => {
            const agg = specsAggregation.get(pathKey);
            if (!agg) return null;

            const specId = pathKey.includes(':') ? pathKey.split(':').pop()! : pathKey;
            const def = specDefinitions.find((s: any) => s.id === specId || s.name === specId);
            
            // 如果找不到定義，嘗試從產品的原始 table_settings 中找 path (僅限新格式)
            let displayName = def?.name;
            if (!displayName && product.variants) {
                // 遍歷所有變體找這個 ID 的 path
                for (const v of product.variants) {
                    if (Array.isArray(v.table_settings)) {
                        const entry = (v.table_settings as any[]).find(e => e.id === specId);
                        if (entry?.path && !entry.path.match(/^[0-9a-f-]{36}$/i)) {
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

    // 獲取目前應顯示的價格
    const currentPriceDisplay = useMemo(() => {
        if (!product) return "$0";
        if (selectedVariant) return `$${selectedVariant.retail_price}`;
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
                wholesale_price: selectedVariant.wholesale_price,
                retail_price: selectedVariant.retail_price,
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

                        {(product.brand_id || product.model) && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">品牌 / 型號</h3>
                                <p className="mt-1">
                                    {getBrandName(product.brand_id)} / {product.model || '-'}
                                </p>
                            </div>
                        )}

                        <div className="pt-4 border-t">
                            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">產品描述</h3>
                            <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                                {product.description || "尚無詳細描述。"}
                            </div>
                        </div>

                        {combinedSpecs.length > 0 && (
                            <div className="pt-4 border-t">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">產品規格</h3>
                                <div className="space-y-2">
                                    {combinedSpecs.map((spec) => {
                                        const specId = spec.id.split(':').pop();
                                        const def = specDefinitions.find((s: any) => s.id === specId);
                                        const isTable = def?.type === 'table';

                                        return (
                                            <div key={spec.id} className="flex flex-col text-sm py-2 border-b last:border-0 border-muted">
                                                <div className="flex justify-between items-center w-full">
                                                    <span 
                                                        className={cn(
                                                            "text-muted-foreground transition-all duration-200",
                                                            spec.level > 0 && "pl-4 text-xs flex items-center gap-1"
                                                        )}
                                                    >
                                                        {spec.level > 0 && <span className="opacity-50 text-[10px]">└─</span>}
                                                        {spec.name}
                                                    </span>
                                                    {!isTable && (
                                                        <span className={cn(
                                                            "font-medium text-right transition-all duration-200",
                                                            (spec as any).isMultiple && "text-muted-foreground/40 italic font-normal"
                                                        )}>
                                                            {formatSpecValue(spec.value)}
                                                        </span>
                                                    )}
                                                </div>
                                                {isTable && spec.value && (
                                                    <SpecTableDisplay value={spec.value} columns={def?.configuration?.columns || []} />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="pt-6">
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

                {product.has_variants && product.variants && product.variants.length > 0 && (
                    <div className="mt-6 border-t pt-4">
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">選擇規格選項</h3>
                        <div className="flex flex-wrap gap-2">
                            {product.variants.map((v) => (
                                <Badge 
                                    key={v.id} 
                                    variant={selectedVariantId === v.id ? "default" : "outline"}
                                    className="px-3 py-1.5 cursor-pointer hover:bg-primary/10 transition-colors text-sm"
                                    onClick={() => setSelectedVariantId(selectedVariantId === v.id ? null : v.id)}
                                >
                                    {v.name}
                                    {selectedVariantId === v.id && <span className="ml-1.5 opacity-70">✓</span>}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
