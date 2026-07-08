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
import { Trash2, Package, Tag, Calculator, Save } from 'lucide-react';
import { Tables } from '@/integrations/supabase/types';

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
}

interface OrderItemsTableProps {
    items: OrderItemRow[];
    products?: Tables<'products'>[];
    onUpdateQuantity: (index: number, value: number) => void;
    onUpdatePrice?: (index: number, value: number) => void;
    onRemove: (index: number) => void;
    isEditable: boolean;
    priceSyncMap?: Record<string, boolean>;
    onTogglePriceSync?: (id: string, checked: boolean) => void;
}

export function OrderItemsTable({
    items,
    products,
    onUpdateQuantity,
    onUpdatePrice,
    onRemove,
    isEditable,
    priceSyncMap,
    onTogglePriceSync,
}: OrderItemsTableProps) {

    const getComponentInfo = (item: OrderItemRow) => {
        if (item.productName && item.sku) {
            return { name: item.productName, sku: item.sku };
        }
        if (products) {
            const p = products.find(p => p.id === item.productId);
            if (p) return { name: p.name, sku: p.sku };
        }
        return { name: '未知產品', sku: '' };
    };

    const getTotalAmount = () => {
        return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    };

    const showPriceInput = !!onUpdatePrice && isEditable;
    const showPriceSync = !!priceSyncMap && !!onTogglePriceSync;

    return (
        <div className="space-y-4">
            {/* Desktop Table */}
            <div className="hidden md:block rounded-md border">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead className="w-[140px]">SKU</TableHead>
                            <TableHead className="w-[120px]">變體</TableHead>
                            <TableHead>產品名稱</TableHead>
                            <TableHead className="text-right w-28">單價</TableHead>
                            <TableHead className="w-24">數量</TableHead>
                            <TableHead className="text-right w-28">小計</TableHead>
                            {showPriceSync && <TableHead className="w-24 text-center">存為店價</TableHead>}
                            {isEditable && <TableHead className="w-12"></TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {items.map((item, index) => {
                            const { name, sku } = getComponentInfo(item);
                            return (
                                <TableRow key={item.id}>
                                    <TableCell className="font-mono text-sm">
                                        {sku}
                                        {item.isNew && <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">新增</Badge>}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {item.variantName || '-'}
                                        {item.selectedModelName && (
                                            <div className="text-xs text-muted-foreground/70">{item.selectedModelName}</div>
                                        )}
                                    </TableCell>
                                    <TableCell className="font-medium">{name}</TableCell>
                                    <TableCell className="text-right">
                                        {showPriceInput ? (
                                            <Input
                                                type="number"
                                                value={item.unitPrice}
                                                onChange={(e) => onUpdatePrice && onUpdatePrice(index, parseFloat(e.target.value) || 0)}
                                                className="w-24 text-right ml-auto h-8"
                                            />
                                        ) : (
                                            <span>${item.unitPrice.toFixed(2)}</span>
                                        )}
                                    </TableCell>
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
                                    <TableCell className="text-right font-semibold">
                                        ${(item.quantity * item.unitPrice).toFixed(2)}
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
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onRemove(index)}
                                                className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    )}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
                {items.map((item, index) => {
                    const { name, sku } = getComponentInfo(item);
                    return (
                        <div key={item.id} className="bg-card border rounded-lg p-4 shadow-sm space-y-3 relative overflow-hidden">
                            {item.isNew && (
                                <div className="absolute top-0 left-0 bg-green-500 text-white text-[10px] px-2 py-0.5 rounded-br-lg">
                                    NEW
                                </div>
                            )}

                            <div className="flex justify-between items-start pt-1">
                                <div className="space-y-1">
                                    <div className="text-xs font-mono text-muted-foreground">{sku}</div>
                                    <div className="font-bold text-sm leading-snug">{name}</div>
                                    {item.variantName && (
                                        <div className="text-xs text-muted-foreground">{item.variantName}</div>
                                    )}
                                    {item.selectedModelName && (
                                        <div className="text-xs text-muted-foreground/70">型號: {item.selectedModelName}</div>
                                    )}
                                </div>
                                {isEditable && (
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => onRemove(index)}
                                        className="text-destructive border-destructive/20 h-8 w-8"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-dashed">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                                        <Tag className="h-3 w-3" /> 單價
                                    </label>
                                    {showPriceInput ? (
                                        <Input
                                            type="number"
                                            value={item.unitPrice}
                                            onChange={(e) => onUpdatePrice && onUpdatePrice(index, parseFloat(e.target.value) || 0)}
                                            className="h-9"
                                        />
                                    ) : (
                                        <div className="font-medium p-1.5 text-sm">${item.unitPrice.toFixed(2)}</div>
                                    )}
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                                        <Package className="h-3 w-3" /> 數量
                                    </label>
                                    {isEditable ? (
                                        <Input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => onUpdateQuantity(index, parseInt(e.target.value) || 1)}
                                            className="h-9"
                                            min={1}
                                        />
                                    ) : (
                                        <div className="font-medium p-1.5 text-sm">{item.quantity}</div>
                                    )}
                                </div>
                            </div>

                            {showPriceSync && (
                                <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                                    <Checkbox
                                        id={`sync-${item.id}`}
                                        checked={priceSyncMap?.[item.id] ?? false}
                                        onCheckedChange={(checked) => onTogglePriceSync?.(item.id, !!checked)}
                                    />
                                    <label htmlFor={`sync-${item.id}`} className="cursor-pointer flex items-center gap-1">
                                        <Save className="h-3 w-3" /> 存為店價
                                    </label>
                                </div>
                            )}

                            <div className="flex justify-between items-center bg-muted/30 p-2 rounded-md">
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Calculator className="h-3 w-3" /> 小計
                                </span>
                                <span className="font-bold text-primary">
                                    ${(item.quantity * item.unitPrice).toFixed(2)}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="flex justify-between items-center mt-6 pt-4 border-t">
                <div className="text-sm text-muted-foreground">共計 {items.length} 項產品</div>
                <div className="text-xl font-bold text-primary">
                    總計：${getTotalAmount().toFixed(2)}
                </div>
            </div>
        </div>
    );
}
