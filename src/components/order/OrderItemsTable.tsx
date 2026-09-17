import { useState, useCallback, useMemo, useRef } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { formatCurrency } from '@/lib/formatters';
import { useTableTemplates } from '@/hooks/useTableTemplates';
import { OrderGridRenderer } from '@/components/order-grid/OrderGridRenderer';
import type { ProductWithPricing } from '@/types/product';
import { OrderItemsToolbar } from './OrderItemsToolbar';
import { OrderItemsDesktopTable } from './OrderItemsDesktopTable';
import { OrderItemsMobileList } from './OrderItemsMobileList';
import type { NameSort, OrderItemRow, OrderItemsTableProps, ViewMode } from './orderItemsTypes';

export function OrderItemsTable({
    items,
    products,
    onUpdateQuantity,
    onUpdatePrice,
    onRemove,
    onSplit,
    isEditable,
    onReorder,
    priceSyncMap,
    onTogglePriceSync,
    defaultCompact = false,
    priceLabel = '單價',
}: OrderItemsTableProps) {
    const [viewMode, setViewMode] = useState<ViewMode>(
        defaultCompact ? 'compact' : 'detailed'
    );
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    const { templates } = useTableTemplates();

    // 获取变体及其关键选项
    const getVariantWithOptions = (item: OrderItemRow) => {
        if (!item.variantId || !products) return { variant: null, keyOptions: [] };
        for (const p of products) {
            if (p.id === item.productId) {
                const variant = (p as any).variants?.find((v: any) => v.id === item.variantId);
                if (variant) {
                    // 取前 2 个 option_group（按 sort_order）作为关键选项
                    const keyOpts = ((p as any).option_groups || [])
                        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                        .slice(0, 2)
                        .map((og: any) => {
                            const val = variant.option_values?.find(
                                (ov: any) => ov.option_group_id === og.id
                            )?.value;
                            return { name: og.name, value: val || '-' };
                        });
                    return { variant, keyOptions: keyOpts };
                }
            }
        }
        return { variant: null, keyOptions: [] };
    };

    // 获取适用于当前 order items 的 templates
    const applicableTemplates = useMemo(() => {
        if (!templates || templates.length === 0) return [];
        const variantIds = new Set(items.flatMap(item => item.variantId).filter((v): v is string => !!v));
        return templates.filter(t => {
            const tvIds = new Set(t.template_variants?.map(tv => tv.variant_id) || []);
            return Array.from(variantIds).some(vid => tvIds.has(vid));
        });
    }, [templates, items]);

    // 自动选择第一个 template
    const currentTemplate = useMemo(() => {
        if (applicableTemplates.length === 0) return null;
        const tid = selectedTemplateId || applicableTemplates[0]?.id;
        return applicableTemplates.find(t => t.id === tid) || null;
    }, [applicableTemplates, selectedTemplateId]);

    const getComponentInfo = (item: OrderItemRow) => {
        if (item.variantName) {
            return { name: item.variantName };
        }
        if (item.productName) {
            return { name: item.productName };
        }
        if (products) {
            const p = products.find(p => p.id === item.productId);
            if (p) return { name: p.name };
        }
        return { name: '未知產品' };
    };

    const getTotalAmount = () => {
        return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    };

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        onReorder?.(arrayMove(items, oldIndex, newIndex));
        setNameSort('default');
    }, [items, onReorder]);

    const showPriceInput = !!onUpdatePrice && isEditable;
    const showPriceSync = !!priceSyncMap && !!onTogglePriceSync;
    const canReorder = !!onReorder && isEditable;

    const sortedItems = useMemo(() => {
        if (!canReorder) return items;
        return [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }, [items, canReorder]);

    // 名稱欄位排序（點擊表頭，default → asc → desc → default 循環）
    const [nameSort, setNameSort] = useState<NameSort>('default');
    const manualOrderRef = useRef<string[]>([]);

    const compareByName = (a: OrderItemRow, b: OrderItemRow) => {
        return getComponentInfo(a).name.localeCompare(getComponentInfo(b).name, 'zh-Hant-TW', { sensitivity: 'base' });
    };

    const handleNameHeaderClick = () => {
        if (!canReorder) return;
        if (nameSort === 'default') {
            manualOrderRef.current = items.map(i => i.id);
            onReorder?.([...items].sort(compareByName));
            setNameSort('asc');
        } else if (nameSort === 'asc') {
            onReorder?.([...items].sort((a, b) => compareByName(b, a)));
            setNameSort('desc');
        } else {
            const manualIds = manualOrderRef.current;
            const manualItems = manualIds
                .map(id => items.find(i => i.id === id))
                .filter((i): i is OrderItemRow => !!i);
            const rest = items.filter(i => !manualIds.includes(i.id));
            onReorder?.([...manualItems, ...rest]);
            setNameSort('default');
        }
    };

    const gridProducts = useMemo(() => {
        if (viewMode !== 'grid' || !products) return [];
        return (products as any as ProductWithPricing[]) || [];
    }, [viewMode, products]);

    return (
        <div className="space-y-4">
            <OrderItemsToolbar
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onEnterGrid={() => {
                    if (applicableTemplates.length > 0) {
                        setViewMode('grid');
                        setSelectedTemplateId(applicableTemplates[0].id);
                    }
                }}
                applicableTemplates={applicableTemplates}
                selectedTemplateId={selectedTemplateId}
                onTemplateChange={setSelectedTemplateId}
            />

            {/* 网格模式 - 有 Template 时显示 OrderGridRenderer */}
            {viewMode === 'grid' && currentTemplate && gridProducts.length > 0 && (
                <div className="rounded-md border p-4 bg-muted/20">
                    <OrderGridRenderer
                        template={currentTemplate}
                        products={gridProducts}
                        onAddToCart={() => {}}
                        initialQuantities={{}}
                    />
                </div>
            )}

            {/* 网格模式 - 无 Template 时显示简化表格（同详细模式布局） */}
            {viewMode === 'grid' && !currentTemplate && (
                <div className="rounded-md border bg-muted/10 p-4 text-center text-sm text-muted-foreground">
                    無適用表格模板，顯示簡化表格
                </div>
            )}

            {/* 简洁和详细模式的表格渲染 */}
            {(viewMode === 'compact' || viewMode === 'detailed') && (
                <>
                    <OrderItemsDesktopTable
                        items={items}
                        sortedItems={sortedItems}
                        canReorder={canReorder}
                        viewMode={viewMode}
                        nameSort={nameSort}
                        onNameHeaderClick={handleNameHeaderClick}
                        priceLabel={priceLabel}
                        showPriceSync={showPriceSync}
                        priceSyncMap={priceSyncMap}
                        onTogglePriceSync={onTogglePriceSync}
                        isEditable={isEditable}
                        showPriceInput={showPriceInput}
                        onUpdateQuantity={onUpdateQuantity}
                        onUpdatePrice={onUpdatePrice}
                        onSplit={onSplit}
                        onRemove={onRemove}
                        onDragEnd={handleDragEnd}
                        getComponentInfo={getComponentInfo}
                        getVariantWithOptions={getVariantWithOptions}
                    />
                    <OrderItemsMobileList
                        items={items}
                        sortedItems={sortedItems}
                        canReorder={canReorder}
                        viewMode={viewMode}
                        isEditable={isEditable}
                        onUpdateQuantity={onUpdateQuantity}
                        onUpdatePrice={onUpdatePrice}
                        onRemove={onRemove}
                        onSplit={onSplit}
                        showPriceInput={showPriceInput}
                        showPriceSync={showPriceSync}
                        priceSyncMap={priceSyncMap}
                        onTogglePriceSync={onTogglePriceSync}
                        priceLabel={priceLabel}
                        onDragEnd={handleDragEnd}
                        getComponentInfo={getComponentInfo}
                        getVariantWithOptions={getVariantWithOptions}
                    />
                </>
            )}

            <div className="flex justify-between items-center mt-6 pt-4 border-t">
                <div className="text-sm text-muted-foreground">共計 {items.length} 項產品</div>
                <div className="text-xl font-bold text-primary">
                    總計：{formatCurrency(getTotalAmount())}
                </div>
            </div>
        </div>
    );
}