import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown, ArrowUpDown, ShoppingCart, ChevronDown, ChevronRight } from 'lucide-react';
import { OrderStatusBadge } from './OrderStatusBadge';
import { LineTypeBadge } from './LineTypeBadge';
import { OrderItem } from '@/types/order';
import { formatCurrency } from '@/lib/formatters';
import { Badge } from '@/components/ui/badge';
import type { NameSort } from './orderItemsTypes';

interface OrderPoBindInfo {
    poCode: string | null;
    purchasedQty: number;
    receivedQty: number;
    status: 'none' | 'covered' | 'partial' | 'over' | 'stock';
}

interface OrderItemsCardsProps {
    items: OrderItem[];
    /** 品項成本（id → 成本）。未傳則不顯示「成本」。成本未知以 costKnown=false 標示。 */
    costByItem?: Map<string, { unitCost: number | null; costKnown: boolean }>;
    /** 採購綁定（id → 採購狀態）。未傳則不顯示採購 badge。 */
    poBindByItem?: Map<string, OrderPoBindInfo>;
}

export function OrderDetailItemsCards({ items, costByItem, poBindByItem }: OrderItemsCardsProps) {
    const [nameSort, setNameSort] = useState<NameSort>('default');
    const [statusSort, setStatusSort] = useState<NameSort>('default');
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

    const getItemName = (item: OrderItem) => item.product_variant?.name || item.product?.name || '';

    const sortedItems = useMemo(() => {
        const base = [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        if (statusSort !== 'default') {
            const cmp = (a: OrderItem, b: OrderItem) =>
                (a.status ?? '').localeCompare(b.status ?? '', 'zh-Hant-TW', { sensitivity: 'base' });
            return [...base].sort(statusSort === 'asc' ? cmp : (a, b) => cmp(b, a));
        }
        if (nameSort !== 'default') {
            const cmp = (a: OrderItem, b: OrderItem) =>
                getItemName(a).localeCompare(getItemName(b), 'zh-Hant-TW', { sensitivity: 'base' });
            return [...base].sort(nameSort === 'asc' ? cmp : (a, b) => cmp(b, a));
        }
        return base;
    }, [items, nameSort, statusSort]);

    const cycleNameSort = () => {
        setStatusSort('default');
        setNameSort((prev) => (prev === 'default' ? 'asc' : prev === 'asc' ? 'desc' : 'default'));
    };

    const cycleStatusSort = () => {
        setNameSort('default');
        setStatusSort((prev) => (prev === 'default' ? 'asc' : prev === 'asc' ? 'desc' : 'default'));
    };

    return (
        <div className="md:hidden w-full flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto ">
            <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={cycleNameSort} className="h-7 px-2 text-xs">
                    {nameSort === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5 mr-1" />
                    ) : nameSort === 'desc' ? (
                        <ArrowDown className="h-3.5 w-3.5 mr-1" />
                    ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 mr-1 opacity-40" />
                    )}
                    名稱
                </Button>
                <Button variant="ghost" size="sm" onClick={cycleStatusSort} className="h-7 px-2 text-xs">
                    {statusSort === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5 mr-1" />
                    ) : statusSort === 'desc' ? (
                        <ArrowDown className="h-3.5 w-3.5 mr-1" />
                    ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 mr-1 opacity-40" />
                    )}
                    狀態
                </Button>
            </div>
            {sortedItems.map((item) => {
                const bind = poBindByItem?.get(item.id);
                const hasPo = bind && bind.status !== 'none';
                const isExpanded = expandedItems.has(item.id);
                const pending = Math.max(0, item.quantity - (item.shipped_quantity || 0));
                return (
                <Card key={item.id} className={`rounded-2xl w-full ${hasPo ? 'bg-amber-50/60 border-l-2 border-l-amber-500' : ''}`}>
                    <CardContent className="p-2 space-y-3 text-sm">
                        <div className="font-medium min-w-0">
                            <span className="flex items-center flex-wrap gap-1">
                                {hasPo && <ShoppingCart className="h-3.5 w-3.5 text-amber-600 shrink-0" />}
                                <span className="block text-muted-foreground ml-1 break-all">
                                    {item.product_variant?.name || item.product?.name}
                                </span>
                                <LineTypeBadge
                                    row={{
                                        lineType: item.line_type ?? 'sale',
                                        isRepair: item.is_repair ?? false,
                                        returnStatus: item.return_status ?? null,
                                    }}
                                />
                                {hasPo && (
                                    <>
                                        <Badge
                                            variant={bind.status === 'over' ? 'destructive' : bind.status === 'covered' ? 'secondary' : bind.status === 'partial' ? 'outline' : 'secondary'}
                                            className="text-[10px] px-1.5 py-0"
                                        >
                                            {bind.status === 'stock' ? '庫存' : bind.status === 'over' ? '採購超量' : bind.status === 'covered' ? `已採購 ${bind.purchasedQty}` : `待採購 ${Math.max(0, pending - bind.purchasedQty)}`}
                                        </Badge>
                                        <button
                                            type="button"
                                            className="text-[10px] text-muted-foreground"
                                            onClick={() => setExpandedItems((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(item.id)) next.delete(item.id);
                                                else next.add(item.id);
                                                return next;
                                            })}
                                        >
                                            {isExpanded ? '▴' : '▾'}
                                        </button>
                                    </>
                                )}
                            </span>
                            {hasPo && isExpanded && (
                                <div className="mt-1 ml-1 flex flex-wrap gap-2 items-center text-sm bg-amber-50/50 rounded px-2 py-1">
                                    {bind.poCode && (
                                        <span className="font-mono text-muted-foreground">{bind.poCode}</span>
                                    )}
                                    <span className="text-muted-foreground">
                                        已採購 {bind.purchasedQty} / 已收 {bind.receivedQty}
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 min-w-0">
                            <div>
                                <span className="text-muted-foreground">單價：</span>
                                {formatCurrency(item.unit_price)}
                            </div>

                            {costByItem && (
                                <div>
                                    <span className="text-muted-foreground">成本：</span>
                                    {costByItem.get(item.id)?.costKnown === false ? (
                                        <span className="text-amber-600">成本未知</span>
                                    ) : (
                                        formatCurrency(costByItem.get(item.id)?.unitCost ?? 0)
                                    )}
                                </div>
                            )}

                            <div>
                                <span className="text-muted-foreground">數量：</span>
                                {(item.line_type ?? 'sale') === 'return' ? -item.quantity : item.quantity}
                            </div>

                            <div>
                                <span className="text-muted-foreground">已出貨：</span>
                                {item.shipped_quantity}
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">狀態：</span>
                                <OrderStatusBadge status={item.status} type="shipping" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            );
        })}
        </div>
    );
}
