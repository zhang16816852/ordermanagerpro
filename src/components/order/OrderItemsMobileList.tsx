import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import { Package, Tag, Save, Calculator, CopyPlus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { formatCurrency } from '@/lib/formatters';
import { handleColumnNav, selectOnFocus } from './orderItemsHelpers';
import { SortableMobileCard } from './SortableMobileCard';
import type { KeyOption, OrderItemRow, ViewMode } from './orderItemsTypes';

interface OrderItemsMobileListProps {
    items: OrderItemRow[];
    sortedItems: OrderItemRow[];
    canReorder: boolean;
    viewMode: ViewMode;
    isEditable: boolean;
    onUpdateQuantity: (index: number, value: number) => void;
    onUpdatePrice?: (index: number, value: number) => void;
    onRemove: (index: number) => void;
    onSplit?: (index: number) => void;
    showPriceInput: boolean;
    showPriceSync: boolean;
    priceSyncMap?: Record<string, boolean>;
    onTogglePriceSync?: (id: string, checked: boolean) => void;
    priceLabel: string;
    onDragEnd: (event: DragEndEvent) => void;
    getComponentInfo: (item: OrderItemRow) => { name: string };
    getVariantWithOptions: (item: OrderItemRow) => { keyOptions: KeyOption[] };
}

export function OrderItemsMobileList({
    items,
    sortedItems,
    canReorder,
    viewMode,
    isEditable,
    onUpdateQuantity,
    onUpdatePrice,
    onRemove,
    onSplit,
    showPriceInput,
    showPriceSync,
    priceSyncMap,
    onTogglePriceSync,
    priceLabel,
    onDragEnd,
    getComponentInfo,
    getVariantWithOptions,
}: OrderItemsMobileListProps) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );
    return (
        <div className="md:hidden space-y-3">
            {canReorder ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={sortedItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                        {sortedItems.map((item, index) => {
                            const { keyOptions } = getVariantWithOptions(item);
                            return (
                                <SortableMobileCard
                                    key={item.id}
                                    item={item}
                                    index={index}
                                    viewMode={viewMode}
                                    keyOptions={keyOptions}
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
                                    getComponentInfo={getComponentInfo}
                                />
                            );
                        })}
                    </SortableContext>
                </DndContext>
            ) : (
                items.map((item, index) => {
                    const { name } = getComponentInfo(item);
                    const { keyOptions } = getVariantWithOptions(item);
                    return (
                        <div key={item.id} className="bg-card border rounded-lg p-4 shadow-sm space-y-3 relative overflow-hidden">
                            {item.isNew && (
                                <div className="absolute top-0 left-0 bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-br-lg">
                                    NEW
                                </div>
                            )}
                            <div className="flex justify-between items-start pt-1">
                                <div className="space-y-1">
                                    <div className="font-bold text-sm leading-snug">
{name}
                                        {item.isNew && <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">新增</Badge>}
                                    </div>
                                    {viewMode === 'compact' ? (
                                        item.selectedModelName && (<div className="text-xs text-muted-foreground">{item.selectedModelName}</div>)
                                    ) : (
                                        <>
                                            {item.selectedModelName && (<div className="text-xs text-muted-foreground/70">型號: {item.selectedModelName}</div>)}
                                            {/* 关键选项显示 */}
                                            {keyOptions.map((opt, idx) => (
                                                <div key={idx} className="text-xs text-muted-foreground/60">
                                                    {opt.name}: {opt.value}
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </div>
                                {isEditable && (
                                    <div className="flex items-center gap-1.5">
                                        {onSplit && item.quantity > 1 && (
                                            <Button variant="outline" size="icon" onClick={() => onSplit(index)} className="text-muted-foreground h-8 w-8" title="拆分行">
                                                <CopyPlus className="h-4 w-4" />
                                            </Button>
                                        )}
                                        <Button variant="outline" size="icon" onClick={() => onRemove(index)} className="text-destructive border-destructive/20 h-8 w-8">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-dashed">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] text-muted-foreground flex items-center gap-1"><Package className="h-3 w-3" /> 數量</label>
                                    {isEditable ? (
                                        <Input type="number" value={item.quantity} onChange={(e) => onUpdateQuantity(index, parseInt(e.target.value) || 1)} onKeyDown={(e) => handleColumnNav(e, 'qty')} onFocus={selectOnFocus} data-col="qty" className="h-9" min={1} />
                                    ) : (
                                        <div className="font-medium p-1.5 text-sm">{item.quantity}</div>
                                    )}
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> {priceLabel}</label>
                                    {showPriceInput ? (
                                        <Input type="number" value={item.unitPrice} onChange={(e) => onUpdatePrice && onUpdatePrice(index, parseFloat(e.target.value) || 0)} onKeyDown={(e) => handleColumnNav(e, 'price')} onFocus={selectOnFocus} data-col="price" className="h-9" />
                                    ) : (
                                        <div className="font-medium p-1.5 text-sm">{formatCurrency(item.unitPrice)}</div>
                                    )}
                                </div>
                            </div>
                            {showPriceSync && (
                                <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                                    <Checkbox id={`sync-${item.id}`} checked={priceSyncMap?.[item.id] ?? false} onCheckedChange={(checked) => onTogglePriceSync?.(item.id, !!checked)} />
                                    <label htmlFor={`sync-${item.id}`} className="cursor-pointer flex items-center gap-1"><Save className="h-3 w-3" /> 存為店價</label>
                                </div>
                            )}
                            <div className="flex justify-between items-center bg-muted/30 p-2 rounded-md">
                                <span className="text-xs text-muted-foreground flex items-center gap-1"><Calculator className="h-3 w-3" /> 小計</span>
                                <span className="font-bold text-primary">{formatCurrency(item.quantity * item.unitPrice)}</span>
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );
}