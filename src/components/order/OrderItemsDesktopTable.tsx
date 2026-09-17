import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import { ArrowUp, ArrowDown, ArrowUpDown, Trash2, CopyPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/formatters';
import { handleColumnNav, selectOnFocus } from './orderItemsHelpers';
import { SortableTableRow } from './SortableTableRow';
import type { KeyOption, NameSort, OrderItemRow, ViewMode } from './orderItemsTypes';

interface OrderItemsDesktopTableProps {
    items: OrderItemRow[];
    sortedItems: OrderItemRow[];
    canReorder: boolean;
    viewMode: ViewMode;
    nameSort: NameSort;
    onNameHeaderClick: () => void;
    priceLabel: string;
    showPriceSync: boolean;
    priceSyncMap?: Record<string, boolean>;
    onTogglePriceSync?: (id: string, checked: boolean) => void;
    isEditable: boolean;
    showPriceInput: boolean;
    onUpdateQuantity: (index: number, value: number) => void;
    onUpdatePrice?: (index: number, value: number) => void;
    onSplit?: (index: number) => void;
    onRemove: (index: number) => void;
    onDragEnd: (event: DragEndEvent) => void;
    getComponentInfo: (item: OrderItemRow) => { name: string };
    getVariantWithOptions: (item: OrderItemRow) => { keyOptions: KeyOption[] };
}

export function OrderItemsDesktopTable({
    items,
    sortedItems,
    canReorder,
    viewMode,
    nameSort,
    onNameHeaderClick,
    priceLabel,
    showPriceSync,
    priceSyncMap,
    onTogglePriceSync,
    isEditable,
    showPriceInput,
    onUpdateQuantity,
    onUpdatePrice,
    onSplit,
    onRemove,
    onDragEnd,
    getComponentInfo,
    getVariantWithOptions,
}: OrderItemsDesktopTableProps) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );
    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={canReorder ? sortedItems.map(i => i.id) : []} strategy={verticalListSortingStrategy}>
                <div className="hidden md:block rounded-md border">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                {canReorder && <TableHead className="w-8"></TableHead>}
                                {viewMode === 'compact' ? (
                                    canReorder ? (
                                        <TableHead>
                                            <button
                                                type="button"
                                                onClick={onNameHeaderClick}
                                                className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                                            >
                                                名稱
                                                {nameSort === 'asc' ? (
                                                    <ArrowUp className="h-3.5 w-3.5" />
                                                ) : nameSort === 'desc' ? (
                                                    <ArrowDown className="h-3.5 w-3.5" />
                                                ) : (
                                                    <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                                                )}
                                            </button>
                                        </TableHead>
                                    ) : (
                                        <TableHead>名稱</TableHead>
                                    )
                                ) : (
                                    <>
                                        {canReorder ? (
                                            <TableHead>
                                                <button
                                                    type="button"
                                                    onClick={onNameHeaderClick}
                                                    className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                                                >
                                                    名稱
                                                    {nameSort === 'asc' ? (
                                                        <ArrowUp className="h-3.5 w-3.5" />
                                                    ) : nameSort === 'desc' ? (
                                                        <ArrowDown className="h-3.5 w-3.5" />
                                                    ) : (
                                                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                                                    )}
                                                </button>
                                            </TableHead>
                                        ) : (
                                            <TableHead>名稱</TableHead>
                                        )}
                                        {/* 关键选项标题 */}
                                        {items.length > 0 && getVariantWithOptions(items[0]).keyOptions.map((opt, idx) => (
                                            <TableHead key={idx} className="w-[100px]">{opt.name}</TableHead>
                                        ))}
                                    </>
                                )}
                                <TableHead className="w-24">數量</TableHead>
                                <TableHead className="text-right w-28">{priceLabel}</TableHead>
                                <TableHead className="text-right w-28">小計</TableHead>
                                {showPriceSync && <TableHead className="w-24 text-center">存為店價</TableHead>}
                                {isEditable && !canReorder && <TableHead className="w-12"></TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {canReorder
                                ? sortedItems.map((item, index) => {
                                    const { keyOptions } = getVariantWithOptions(item);
                                    return (
                                        <SortableTableRow key={item.id} item={item} index={index} viewMode={viewMode} keyOptions={keyOptions}>
                                            <TableCell>
                                                {isEditable ? (
                                                    <Input
                                                        type="number"
                                                        value={item.quantity}
                                                        onChange={(e) => onUpdateQuantity(index, parseInt(e.target.value) || 1)}
                                                        onKeyDown={(e) => handleColumnNav(e, 'qty')}
                                                        onFocus={selectOnFocus}
                                                        data-col="qty"
                                                        className="w-20 h-8"
                                                        min={1}
                                                    />
                                                ) : (
                                                    <span>{item.quantity}</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {showPriceInput ? (
                                                    <Input
                                                        type="number"
                                                        value={item.unitPrice}
                                                        onChange={(e) => onUpdatePrice && onUpdatePrice(index, parseFloat(e.target.value) || 0)}
                                                        onKeyDown={(e) => handleColumnNav(e, 'price')}
                                                        onFocus={selectOnFocus}
                                                        data-col="price"
                                                        className="w-24 text-right ml-auto h-8"
                                                    />
                                                ) : (
                                                    <span>{formatCurrency(item.unitPrice)}</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold">
                                                {formatCurrency(item.quantity * item.unitPrice)}
                                            </TableCell>
                                            {showPriceSync && (
                                                <TableCell className="text-center">
                                                    <Checkbox
                                                        checked={priceSyncMap?.[item.id] ?? false}
                                                        onCheckedChange={(checked) => onTogglePriceSync?.(item.id, !!checked)}
                                                    />
                                                </TableCell>
                                            )}
                                            {isEditable && (
                                                <TableCell>
                                                    <div className="flex items-center justify-end gap-1">
                                                        {onSplit && item.quantity > 1 && (
                                                            <Button
                                                                variant="ghost" size="icon"
                                                                onClick={() => onSplit(index)}
                                                                className="text-muted-foreground hover:text-foreground hover:bg-muted h-8 w-8"
                                                                title="拆分行"
                                                            >
                                                                <CopyPlus className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="ghost" size="icon"
                                                            onClick={() => onRemove(index)}
                                                            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            )}
                                        </SortableTableRow>
                                    );
                                })
                                : items.map((item, index) => {
                                    const { name } = getComponentInfo(item);
                                    const { keyOptions } = getVariantWithOptions(item);
                                    return (
                                        <TableRow key={item.id}>
                                            {viewMode === 'compact' ? (
                                                <TableCell className="font-medium">
                                                    <div className="flex flex-col">
                                                        <span>{name}</span>
                                                        <span className="text-xs font-mono text-muted-foreground">
                                                            {item.selectedModelName && <span className="ml-2">{item.selectedModelName}</span>}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                            ) : (
                                                <>
                                                    <TableCell className="font-medium">
                                                        {name}
                                                        {item.isNew && <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">新增</Badge>}
                                                    </TableCell>
                                                    {keyOptions.map((opt, idx) => (
                                                        <TableCell key={idx} className="text-xs text-muted-foreground w-[100px]">
                                                            <div className="truncate">{opt.value}</div>
                                                            <div className="text-[10px] text-muted-foreground/70">{opt.name}</div>
                                                        </TableCell>
                                                    ))}
                                                </>
                                            )}
                                            <TableCell>
                                                {isEditable ? (
                                                    <Input
                                                        type="number"
                                                        value={item.quantity}
                                                        onChange={(e) => onUpdateQuantity(index, parseInt(e.target.value) || 1)}
                                                        onKeyDown={(e) => handleColumnNav(e, 'qty')}
                                                        onFocus={selectOnFocus}
                                                        data-col="qty"
                                                        className="w-20 h-8"
                                                        min={1}
                                                    />
                                                ) : (
                                                    <span>{item.quantity}</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {showPriceInput ? (
                                                    <Input
                                                        type="number"
                                                        value={item.unitPrice}
                                                        onChange={(e) => onUpdatePrice && onUpdatePrice(index, parseFloat(e.target.value) || 0)}
                                                        onKeyDown={(e) => handleColumnNav(e, 'price')}
                                                        onFocus={selectOnFocus}
                                                        data-col="price"
                                                        className="w-24 text-right ml-auto h-8"
                                                    />
                                                ) : (
                                                    <span>{formatCurrency(item.unitPrice)}</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold">
                                                {formatCurrency(item.quantity * item.unitPrice)}
                                            </TableCell>
                                            {showPriceSync && (
                                                <TableCell className="text-center">
                                                    <Checkbox
                                                        checked={priceSyncMap?.[item.id] ?? false}
                                                        onCheckedChange={(checked) => onTogglePriceSync?.(item.id, !!checked)}
                                                    />
                                                </TableCell>
                                            )}
                                            {isEditable && (
                                                <TableCell>
                                                    <div className="flex items-center justify-end gap-1">
                                                        {onSplit && item.quantity > 1 && (
                                                            <Button
                                                                variant="ghost" size="icon"
                                                                onClick={() => onSplit(index)}
                                                                className="text-muted-foreground hover:text-foreground hover:bg-muted h-8 w-8"
                                                                title="拆分行"
                                                            >
                                                                <CopyPlus className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="ghost" size="icon"
                                                            onClick={() => onRemove(index)}
                                                            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    );
                                })}
                        </TableBody>
                    </Table>
                </div>
            </SortableContext>
        </DndContext>
    );
}