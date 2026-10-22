import { useState, useMemo } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, ChevronRight, ShoppingCart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { OrderStatusBadge } from './OrderStatusBadge';
import { LineTypeBadge } from './LineTypeBadge';
import { OrderItem } from '@/types/order';
import { formatCurrency } from '@/lib/formatters';
import type { NameSort } from './orderItemsTypes';

interface OrderPoBindInfo {
    poCode: string | null;
    purchasedQty: number;
    receivedQty: number;
    status: 'none' | 'covered' | 'partial' | 'over' | 'stock';
}

interface OrderItemsTableProps {
    items: OrderItem[];
    /** 品項成本（id → 成本）。未傳則不顯示「成本」欄。成本未知以 costKnown=false 標示。 */
    costByItem?: Map<string, { unitCost: number | null; costKnown: boolean }>;
    /** 採購綁定（id → 採購狀態）。未傳則不顯示採購 badge。 */
    poBindByItem?: Map<string, OrderPoBindInfo>;
}

export function OrderDetailItemsTable({ items, costByItem, poBindByItem }: OrderItemsTableProps) {
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

    const handleNameHeaderClick = () => {
        setStatusSort('default');
        setNameSort((prev) => (prev === 'default' ? 'asc' : prev === 'asc' ? 'desc' : 'default'));
    };

    const handleStatusHeaderClick = () => {
        setNameSort('default');
        setStatusSort((prev) => (prev === 'default' ? 'asc' : prev === 'asc' ? 'desc' : 'default'));
    };

    const showCost = !!costByItem;
    return (
        <div className="hidden md:block border rounded-lg flex-1 min-h-0 overflow-y-auto">
            <Table>
                <TableHeader className="bg-muted/50">
                    <TableRow>
                        <TableHead className="sticky top-0 bg-muted/50 z-10">
                            <button
                                type="button"
                                onClick={handleNameHeaderClick}
                                className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                                產品名稱
                                {nameSort === 'asc' ? (
                                    <ArrowUp className="h-3.5 w-3.5" />
                                ) : nameSort === 'desc' ? (
                                    <ArrowDown className="h-3.5 w-3.5" />
                                ) : (
                                    <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                                )}
                            </button>
                        </TableHead>
                        <TableHead className="sticky top-0 bg-muted/50 z-10">數量</TableHead>
                        <TableHead className="sticky top-0 bg-muted/50 z-10">已出貨</TableHead>
                        <TableHead className="sticky top-0 bg-muted/50 z-10">單價</TableHead>
                        <TableHead className="sticky top-0 bg-muted/50 z-10">
                            <button
                                type="button"
                                onClick={handleStatusHeaderClick}
                                className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                                狀態
                                {statusSort === 'asc' ? (
                                    <ArrowUp className="h-3.5 w-3.5" />
                                ) : statusSort === 'desc' ? (
                                    <ArrowDown className="h-3.5 w-3.5" />
                                ) : (
                                    <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                                )}
                            </button>
                        </TableHead>
                        {showCost && (
                            <TableHead className="sticky top-0 bg-muted/50 z-10 text-right">成本</TableHead>
                        )}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedItems.map((item) => {
                        const cost = costByItem?.get(item.id);
                        const bind = poBindByItem?.get(item.id);
                        const hasPo = bind && bind.status !== 'none';
                        const isExpanded = expandedItems.has(item.id);
                        return (
                            <>
                                <TableRow
                                    key={item.id}
                                    className={hasPo ? 'bg-amber-50/60 border-l-2 border-l-amber-500 cursor-pointer hover:bg-amber-50' : ''}
                                    onClick={() => {
                                        if (hasPo) {
                                            setExpandedItems((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(item.id)) next.delete(item.id);
                                                else next.add(item.id);
                                                return next;
                                            });
                                        }
                                    }}
                                >
                                    <TableCell>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="inline-flex items-center flex-wrap gap-1">
                                                {hasPo && <ShoppingCart className="h-3.5 w-3.5 text-amber-600 shrink-0" />}
                                                {item.product_variant?.name || item.product?.name}
                                                <LineTypeBadge
                                                    row={{
                                                        lineType: item.line_type ?? 'sale',
                                                        isRepair: item.is_repair ?? false,
                                                        returnStatus: item.return_status ?? null,
                                                    }}
                                                />
                                                {hasPo && (
                                                    <Badge
                                                        variant={bind.status === 'over' ? 'destructive' : bind.status === 'covered' ? 'secondary' : bind.status === 'partial' ? 'outline' : 'secondary'}
                                                        className="text-[10px] px-1.5 py-0"
                                                    >
                                                        {bind.status === 'stock' ? '庫存' : bind.status === 'over' ? '採購超量' : bind.status === 'covered' ? `已採購 ${bind.purchasedQty}` : `待採購 ${Math.max(0, (item.quantity - (item.shipped_quantity || 0)) - bind.purchasedQty)}`}
                                                    </Badge>
                                                )}
                                                {hasPo && (
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {isExpanded ? '▴' : '▾'}
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {(item.line_type ?? 'sale') === 'return' ? -item.quantity : item.quantity}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {item.shipped_quantity}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {formatCurrency(item.unit_price)}
                                    </TableCell>
                                    <TableCell>
                                        <OrderStatusBadge status={item.status} type="shipping" />
                                    </TableCell>
                                    {showCost && (
                                        <TableCell className="text-right">
                                            {cost?.costKnown === false ? (
                                                <span
                                                    className="text-amber-600"
                                                    title="尚未建立成本資料，請於採購單或商品成本補登"
                                                >
                                                    成本未知
                                                </span>
                                            ) : (
                                                formatCurrency(cost?.unitCost ?? 0)
                                            )}
                                        </TableCell>
                                    )}
                                </TableRow>
                                {hasPo && isExpanded && (
                                    <TableRow key={`${item.id}-po-detail`} className="bg-amber-50/30">
                                        <TableCell colSpan={showCost ? 6 : 5} className="py-2 px-4">
                                            <div className="flex flex-wrap gap-2 items-center text-sm">
                                                {bind.poCode && (
                                                    <span className="font-mono text-muted-foreground">{bind.poCode}</span>
                                                )}
                                                <span className="text-muted-foreground">
                                                    已採購 {bind.purchasedQty} / 已收 {bind.receivedQty}
                                                </span>
                                                {bind.receivedQty > 0 && (
                                                    <span className="text-green-600">已收貨 {bind.receivedQty}</span>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
