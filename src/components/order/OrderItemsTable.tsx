import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Trash2 } from 'lucide-react';
import { Tables } from '@/integrations/supabase/types';

export interface OrderItemRow {
    id: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    isNew?: boolean;
}

interface OrderItemsTableProps {
    items: OrderItemRow[];
    products: Tables<'products'>[];
    onUpdateQuantity: (index: number, value: number) => void;
    onUpdatePrice?: (index: number, value: number) => void; // Optional: Only provided if editable
    onRemove: (index: number) => void;
    isEditable: boolean;
}

export function OrderItemsTable({
    items,
    products,
    onUpdateQuantity,
    onUpdatePrice,
    onRemove,
    isEditable,
}: OrderItemsTableProps) {

    const getComponentName = (productId: string) => {
        const p = products.find(p => p.id === productId);
        return {
            name: p?.name || '未知產品',
            sku: p?.sku || ''
        };
    };

    const getTotalAmount = () => {
        return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    };

    const showPriceInput = !!onUpdatePrice && isEditable;

    return (
        <>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>產品名稱</TableHead>
                        <TableHead className="text-right w-32">單價</TableHead>
                        <TableHead className="w-32">數量</TableHead>
                        <TableHead className="text-right">小計</TableHead>
                        {isEditable && <TableHead className="w-12"></TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((item, index) => {
                        const { name, sku } = getComponentName(item.productId);
                        return (
                            <TableRow key={item.id}>
                                <TableCell className="font-mono text-sm">
                                    {sku}
                                    {item.isNew && <Badge variant="outline" className="ml-2">新增</Badge>}
                                </TableCell>
                                <TableCell>{name}</TableCell>
                                <TableCell className="text-right">
                                    {showPriceInput ? (
                                        <Input
                                            type="number"
                                            value={item.unitPrice}
                                            onChange={(e) => onUpdatePrice && onUpdatePrice(index, parseFloat(e.target.value) || 0)}
                                            className="w-24 text-right ml-auto"
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
                                            className="w-20"
                                            min={1}
                                        />
                                    ) : (
                                        <span>{item.quantity}</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                    ${(item.quantity * item.unitPrice).toFixed(2)}
                                </TableCell>
                                {isEditable && (
                                    <TableCell>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => onRemove(index)}
                                            className="text-destructive hover:text-destructive"
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

            <div className="flex justify-between items-center mt-6 pt-4 border-t">
                <div className="text-lg font-semibold">
                    總計：${getTotalAmount().toFixed(2)}
                </div>
            </div>
        </>
    );
}
