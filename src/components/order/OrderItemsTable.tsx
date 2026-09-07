import { useState, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Trash2, Package, Tag, Calculator, Save, LayoutList, Rows3, GripVertical, Grid3x3, ArrowUpDown, ArrowUp, ArrowDown, CopyPlus } from 'lucide-react';
import { Tables } from '@/integrations/supabase/types';
import { formatCurrency } from '@/lib/formatters';
import {
    DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTableTemplates } from '@/hooks/useTableTemplates';
import { OrderGridRenderer } from '@/components/order-grid/OrderGridRenderer';
import type { ProductWithPricing } from '@/types/product';

export interface OrderItemRow {
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    isNew?: boolean;
    variantId?: string;
    variantName?: string;
    selectedModelName?: string;
    sku?: string;
    productName?: string;
    sort_order?: number;
    itemType?: 'product' | 'shipping' | 'packaging' | 'repair_part';
    unitCost?: number;
    shippingPayment?: string | null;
    tempKey?: string;
    parentTempKey?: string;
}

interface OrderItemsTableProps {
    items: OrderItemRow[];
    products?: Tables<'products'>[];
    onUpdateQuantity: (index: number, value: number) => void;
    onUpdatePrice?: (index: number, value: number) => void;
    onRemove: (index: number) => void;
    onSplit?: (index: number) => void;
    isEditable: boolean;
    onReorder?: (items: OrderItemRow[]) => void;
    priceSyncMap?: Record<string, boolean>;
    onTogglePriceSync?: (id: string, checked: boolean) => void;
    defaultCompact?: boolean;
    priceLabel?: string;
}

function SortableTableRow({ item, index, viewMode, keyOptions, children }: { item: OrderItemRow; index: number; viewMode: 'compact' | 'detailed' | 'grid'; keyOptions: Array<{ name: string; value: string }>; children: React.ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 };
    return (
        <TableRow ref={setNodeRef} style={style} {...attributes}>
            <TableCell {...listeners} className="cursor-grab active:cursor-grabbing w-8 text-center text-muted-foreground hover:text-foreground">
                <GripVertical className="h-4 w-4 mx-auto" />
            </TableCell>
            {viewMode === 'compact' ? (
                <TableCell className="font-medium">
                    <div className="flex flex-col">
                        <span>{item.variantName || item.productName || item.sku || item.id.slice(0, 8)}</span>
                        <span className="inline-flex items-center gap-1 flex-wrap">
                            {item.selectedModelName && <span className="text-xs font-mono text-muted-foreground">{item.selectedModelName}</span>}
                            <ServiceItemBadge item={item} />
                        </span>
                    </div>
                </TableCell>
            ) : (
                <>
                    <TableCell className="font-medium">
                        {item.variantName || item.productName || item.sku || item.id.slice(0, 8)}
                        {item.isNew && <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">新增</Badge>}
                        <ServiceItemBadge item={item} />
                    </TableCell>
                    {/* 关键选项欄位 */}
                    {keyOptions.map((opt, idx) => (
                        <TableCell key={idx} className="text-xs text-muted-foreground w-[100px]">
                            <div className="truncate">{opt.value}</div>
                            <div className="text-[10px] text-muted-foreground/70">{opt.name}</div>
                        </TableCell>
                    ))}
                </>
            )}
            {children}
        </TableRow>
    );
}

export function ServiceItemBadge({ item }: { item: OrderItemRow }) {
    if (item.itemType === 'shipping') {
        return (
            <Badge variant="secondary" className="ml-2 bg-orange-50 text-orange-700 border-orange-200">
                運費{item.shippingPayment === 'monthly' ? '・月結' : ''}
            </Badge>
        );
    }
    if (item.itemType === 'packaging') {
        return (
            <Badge variant="secondary" className="ml-2 bg-sky-50 text-sky-700 border-sky-200">包裝</Badge>
        );
    }
    if (item.parentTempKey) {
        return <Badge variant="outline" className="ml-2 text-muted-foreground">加購</Badge>;
    }
    return null;
}

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
    const [viewMode, setViewMode] = useState<'compact' | 'detailed' | 'grid'>(
        defaultCompact ? 'compact' : 'detailed'
    );
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
    const { templates } = useTableTemplates();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

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
    const [nameSort, setNameSort] = useState<'default' | 'asc' | 'desc'>('default');
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

    // 三模式循环切换
    const cycleViewMode = () => {
        if (viewMode === 'compact') {
            setViewMode('detailed');
        } else if (viewMode === 'detailed') {
            if (applicableTemplates.length > 0) {
                setViewMode('grid');
                setSelectedTemplateId(applicableTemplates[0].id);
            } else {
                setViewMode('compact');
            }
        } else {
            setViewMode('compact');
        }
    };

    const gridProducts = useMemo(() => {
        if (viewMode !== 'grid' || !products) return [];
        return (products as any as ProductWithPricing[]) || [];
    }, [viewMode, products]);

    return (
        <div className="space-y-4">
            {/* 三模式切换按钮 + Template 下拉菜单 */}
            <div className="flex items-center gap-2 flex-wrap">
                <Button
                    variant={viewMode === 'compact' ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setViewMode('compact')}
                >
                    <LayoutList className="h-3.5 w-3.5 mr-1" />簡潔
                </Button>
                <Button
                    variant={viewMode === 'detailed' ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setViewMode('detailed')}
                >
                    <Rows3 className="h-3.5 w-3.5 mr-1" />詳細
                </Button>
                <Button
                    variant={viewMode === 'grid' ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                        if (applicableTemplates.length > 0) {
                            setViewMode('grid');
                            setSelectedTemplateId(applicableTemplates[0].id);
                        }
                    }}
                    disabled={applicableTemplates.length === 0}
                >
                    <Grid3x3 className="h-3.5 w-3.5 mr-1" />表格
                </Button>

                {/* Template 下拉菜单（仅网格模式显示） */}
                {viewMode === 'grid' && applicableTemplates.length > 0 && (
                    <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                        <SelectTrigger className="w-[200px] h-7 text-xs">
                            <SelectValue placeholder="选择表格模板" />
                        </SelectTrigger>
                        <SelectContent>
                            {applicableTemplates.map(t => (
                                <SelectItem key={t.id} value={t.id} className="text-xs">
                                    {t.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                {viewMode === 'grid' && applicableTemplates.length === 0 && (
                    <span className="text-xs text-muted-foreground">無適用表格模板</span>
                )}
            </div>

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
                    {/* Desktop Table */}
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
                                                    onClick={handleNameHeaderClick}
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
                                                        onClick={handleNameHeaderClick}
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
                            {canReorder ? (
                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                    <SortableContext items={sortedItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                                        <TableBody>
                                            {sortedItems.map((item, index) => {
                                                const { keyOptions } = getVariantWithOptions(item);
                                                return (
                                                    <SortableTableRow key={item.id} item={item} index={index} viewMode={viewMode} keyOptions={keyOptions}>
                                                        <TableCell>
                                                            {isEditable ? (
                                                                <Input
                                                                    type="number"
                                                                    value={item.quantity}
                                                                    onChange={(e) => onUpdateQuantity(index, parseInt(e.target.value) || 1)}
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
                                            })}
                                        </TableBody>
                                    </SortableContext>
                                </DndContext>
                            ) : (
                                <TableBody>
                                    {items.map((item, index) => {
                                        const { name } = getComponentInfo(item);
                                        const { keyOptions } = getVariantWithOptions(item);
                                        return (
                                            <TableRow key={item.id}>
                                                {viewMode === 'compact' ? (
                                                    <TableCell className="font-medium">
                                                        <div className="flex flex-col">
                                                            <span>{name} - {item.variantName || '無變體'}</span>
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
                            )}
                        </Table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden space-y-3">
                        {canReorder ? (
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                                                    {viewMode === 'compact' ? `${name} - ${item.variantName || '無變體'}` : name}
                                                    {item.isNew && <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">新增</Badge>}
                                                </div>
                                                {viewMode === 'compact' ? (
                                                    item.selectedModelName && (<div className="text-xs text-muted-foreground">{item.selectedModelName}</div>)
                                                ) : (
                                                    <>
                                                        {item.variantName && (<div className="text-xs text-muted-foreground">{item.variantName}</div>)}
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
                                                    <Input type="number" value={item.quantity} onChange={(e) => onUpdateQuantity(index, parseInt(e.target.value) || 1)} className="h-9" min={1} />
                                                ) : (
                                                    <div className="font-medium p-1.5 text-sm">{item.quantity}</div>
                                                )}
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> {priceLabel}</label>
                                                {showPriceInput ? (
                                                    <Input type="number" value={item.unitPrice} onChange={(e) => onUpdatePrice && onUpdatePrice(index, parseFloat(e.target.value) || 0)} className="h-9" />
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

function SortableMobileCard({
    item,
    index,
    viewMode,
    keyOptions,
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
    getComponentInfo,
}: {
    item: OrderItemRow;
    index: number;
    viewMode: 'compact' | 'detailed' | 'grid';
    keyOptions: Array<{ name: string; value: string }>;
    isEditable: boolean;
    onUpdateQuantity: (index: number, value: number) => void;
    onUpdatePrice?: (index: number, value: number) => void;
    onRemove: (index: number) => void;
    onSplit?: (index: number) => void;
    showPriceInput: boolean;
    showPriceSync: boolean;
    priceSyncMap: Record<string, boolean> | undefined;
    onTogglePriceSync?: (id: string, checked: boolean) => void;
    priceLabel: string;
    getComponentInfo: (item: OrderItemRow) => { name: string };
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 };
    const { name } = getComponentInfo(item);
    return (
        <div ref={setNodeRef} style={style} {...attributes} className="bg-card border rounded-lg p-4 shadow-sm space-y-3 relative overflow-hidden">
            <div {...listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground absolute top-2 right-2">
                <GripVertical className="h-4 w-4" />
            </div>
            {item.isNew && (
                <div className="absolute top-0 left-0 bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-br-lg">NEW</div>
            )}
            <div className="flex justify-between items-start pt-1">
                <div className="space-y-1">
                    <div className="font-bold text-sm leading-snug">
                        {viewMode === 'compact' ? `${name} - ${item.variantName || '無變體'}` : name}
                        {item.isNew && <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">新增</Badge>}
                    </div>
                    {viewMode === 'compact' ? (
                        item.selectedModelName && (<div className="text-xs text-muted-foreground">{item.selectedModelName}</div>)
                    ) : (
                        <>
                            {item.variantName && (<div className="text-xs text-muted-foreground">{item.variantName}</div>)}
                            {item.selectedModelName && (<div className="text-xs text-muted-foreground/70">型號: {item.selectedModelName}</div>)}
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
                        <Input type="number" value={item.quantity} onChange={(e) => onUpdateQuantity(index, parseInt(e.target.value) || 1)} className="h-9" min={1} />
                    ) : (
                        <div className="font-medium p-1.5 text-sm">{item.quantity}</div>
                    )}
                </div>
                <div className="space-y-1.5">
                    <label className="text-[10px] text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> {priceLabel}</label>
                    {showPriceInput ? (
                        <Input type="number" value={item.unitPrice} onChange={(e) => onUpdatePrice && onUpdatePrice(index, parseFloat(e.target.value) || 0)} className="h-9" />
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
}
