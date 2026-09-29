import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { calculatePriceRange } from '@/utils/priceUtils';
import { ProductActionsMenu } from './ProductActionsMenu';
import { SpecFormatBadge } from './ProductSpecFormatBadge';
import { PRODUCT_STATUS_LABELS, PRODUCT_STATUS_VARIANTS, getProductBrandLabel } from './productRowHelpers';
import type { ProductsListViewProps } from './productsListTypes';

export function ProductsCardList({
    products,
    isLoading,
    brandMap,
    selectedIds,
    isAllSelected,
    expandedIds,
    onToggleSelectAll,
    onToggleSelect,
    onToggleExpand,
    getVariants,
    getModels,
    getModelGroups,
    onEdit,
    onCopy,
    onDelete,
    onUpdateVariant
}: ProductsListViewProps) {
    if (isLoading) {
        return (
            <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="rounded-xl border bg-card p-3 space-y-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                        <Skeleton className="h-3 w-1/2" />
                    </div>
                ))}
            </div>
        );
    }

    const list = products || [];

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox
                        checked={isAllSelected}
                        onCheckedChange={onToggleSelectAll}
                        aria-label="全選產品"
                    />
                    全選目前 {list.length} 項
                </label>
                {selectedIds.size > 0 && (
                    <span className="text-xs text-primary font-medium">已選 {selectedIds.size} 項</span>
                )}
            </div>

            {list.length === 0 ? (
                <div className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
                    找不到符合條件的產品
                </div>
            ) : (
                list.map((product) => {
                    const variants = getVariants(product.id);
                    const hasVariants = variants.length > 0;
                    const isSelected = selectedIds.has(product.id);
                    const isExpanded = expandedIds.has(product.id);
                    const models = getModels ? getModels(product.id) : [];
                    const modelGroups = getModelGroups ? getModelGroups(product.id) : [];
                    const displayBrand = getProductBrandLabel(product as any, brandMap);

                    return (
                        <div
                            key={product.id}
                            className={`rounded-xl border bg-card shadow-sm overflow-hidden ${isSelected ? 'ring-1 ring-primary/40' : ''}`}
                        >
                            <div className="flex items-start gap-2 p-3">
                                <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => onToggleSelect(product.id)}
                                    aria-label={`選取 ${product.name}`}
                                    className="mt-0.5"
                                />
                                <div className="min-w-0 flex-1 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex-1 text-sm font-medium leading-snug break-words">
                                            {product.name}
                                        </div>
                                        <ProductActionsMenu
                                            product={product}
                                            onEdit={onEdit}
                                            onCopy={onCopy}
                                            onDelete={onDelete}
                                        />
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1">
                                        {hasVariants && (
                                            <Badge variant="outline" className="text-[10px] h-5">
                                                <Layers className="h-3 w-3 mr-1" />
                                                {variants.length} 變體
                                            </Badge>
                                        )}
                                        {(product as any).unified_pricing && (
                                            <Badge variant="outline" className="text-[10px] h-5 border-emerald-300 bg-emerald-50 text-emerald-700">
                                                統一價格
                                            </Badge>
                                        )}
                                        {!hasVariants && (
                                            <SpecFormatBadge specValues={(product as any).spec_values} />
                                        )}
                                        {((product as any).category_names?.length > 0)
                                            ? (product as any).category_names.map((name: string, idx: number) => (
                                                <Badge key={`${product.id}-cat-${idx}`} variant="outline" className="text-[10px] px-1 h-5">
                                                    {name}
                                                </Badge>
                                            ))
                                            : null}
                                    </div>

                                    <div className="text-xs text-muted-foreground font-mono truncate" title={displayBrand}>
                                        {displayBrand}
                                    </div>

                                    {(models.length > 0 || modelGroups.length > 0) && (
                                        <div className="flex flex-wrap gap-1">
                                            {models.map((model, idx) => (
                                                <Badge key={`${product.id}-model-${idx}`} variant="secondary" className="text-[9px] px-1 h-4 bg-amber-100 text-amber-800 hover:bg-amber-100/80 border-transparent max-w-[12rem] truncate">
                                                    {model}
                                                </Badge>
                                            ))}
                                            {modelGroups.map((name, idx) => (
                                                <Badge key={`${product.id}-group-${idx}`} variant="secondary" className="text-[9px] px-1 h-4 bg-blue-100 text-blue-800 hover:bg-blue-100/80 border-transparent max-w-[12rem] truncate">
                                                    {name}
                                                </Badge>
                                            ))}
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-2 border-t pt-2">
                                        <div className="min-w-0">
                                            <div className="text-[10px] text-muted-foreground">批發價</div>
                                            <div className="text-sm font-semibold truncate">
                                                {calculatePriceRange(undefined, variants.map((v: any) => v.wholesale_price)).display}
                                            </div>
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-[10px] text-muted-foreground">零售價</div>
                                            <div className="text-sm text-muted-foreground truncate">
                                                {calculatePriceRange(undefined, variants.map((v: any) => v.retail_price)).display}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {hasVariants && (
                                <Collapsible open={isExpanded} onOpenChange={() => onToggleExpand(product.id)}>
                                    <CollapsibleTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label={`${isExpanded ? '收合' : '展開'} ${product.name} 的變體`}
                                            className="flex w-full items-center justify-center gap-1 border-t bg-muted/30 py-2 text-xs font-medium text-muted-foreground"
                                        >
                                            {isExpanded
                                                ? <ChevronDown className="h-3.5 w-3.5" />
                                                : <ChevronRight className="h-3.5 w-3.5" />}
                                            {isExpanded ? '收合變體' : `展開 ${variants.length} 個變體`}
                                        </button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <div className="space-y-2 border-t bg-muted/10 p-2">
                                            {variants.map((v: any) => (
                                                <div key={v.id} className="rounded-lg border bg-background p-2 space-y-2">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="min-w-0 text-xs font-medium leading-snug break-words">{v.name}</div>
                                                        <Badge variant="outline" className={`text-[9px] px-1 h-4 shrink-0 ${PRODUCT_STATUS_VARIANTS[v.status] || ''}`}>
                                                            {PRODUCT_STATUS_LABELS[v.status]}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                                        <span className="min-w-0 break-words">
                                                            {v.option_values?.map((ov: any) => ov.label || ov.value).filter(Boolean).join(' / ') || v.name}
                                                        </span>
                                                        <SpecFormatBadge specValues={v.spec_values} />
                                                    </div>
                                                    {v.device_models && v.device_models.length > 0 && (
                                                        <div className="flex flex-wrap gap-1">
                                                            {v.device_models.map((m: any, idx: number) => (
                                                                <Badge key={m.id || idx} variant="secondary" className="text-[8px] px-1 h-3.5 bg-amber-50 text-amber-900 border-amber-200 max-w-[12rem] truncate">
                                                                    {m.name}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="min-w-0">
                                                            <label className="text-[10px] text-muted-foreground" htmlFor={`w-${v.id}`}>批發價</label>
                                                            <Input
                                                                id={`w-${v.id}`}
                                                                type="number"
                                                                className="h-8 text-xs text-right border-dashed"
                                                                defaultValue={v.wholesale_price}
                                                                onBlur={(e) => {
                                                                    const val = parseFloat(e.target.value);
                                                                    if (!isNaN(val) && val !== v.wholesale_price) {
                                                                        onUpdateVariant(v.id, { wholesale_price: val });
                                                                    }
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <label className="text-[10px] text-muted-foreground" htmlFor={`r-${v.id}`}>零售價</label>
                                                            <Input
                                                                id={`r-${v.id}`}
                                                                type="number"
                                                                className="h-8 text-xs text-right border-dashed"
                                                                defaultValue={v.retail_price}
                                                                onBlur={(e) => {
                                                                    const val = parseFloat(e.target.value);
                                                                    if (!isNaN(val) && val !== v.retail_price) {
                                                                        onUpdateVariant(v.id, { retail_price: val });
                                                                    }
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </CollapsibleContent>
                                </Collapsible>
                            )}
                        </div>
                    );
                })
            )}
        </div>
    );
}
