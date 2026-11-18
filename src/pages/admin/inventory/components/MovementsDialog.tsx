import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useInventoryMovements } from '../hooks/useInventory';
import { PoRemainingBadge } from './PoRemainingBadge';
import { supabase } from '@/integrations/supabase/client';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { costMatchLabel } from '@/lib/costMatchStatus';

const SOURCE_TYPE_LABELS: Record<string, string> = {
    purchase_receipt: '採購入庫',
    sales_shipment: '出貨扣減',
    sales_note_deletion: '銷貨刪除回補',
    manual_adjustment: '手動調整',
};

export function MovementsDialog({ open, onOpenChange, productId, variantId, name }: { open: boolean; onOpenChange: (open: boolean) => void; productId: string | null; variantId: string | null; name: string }) {
    const { data: movements = [], isLoading } = useInventoryMovements(productId, variantId);
    const [filterType, setFilterType] = useState('');
    const [ascending, setAscending] = useState(true);

    const { data: currentStock } = useQuery({
        queryKey: ['product-inventory-total', productId, variantId],
        enabled: !!productId,
        queryFn: async () => {
            let q: any = (supabase as any).from('product_inventory').select('quantity').eq('product_id', productId);
            if (variantId) q = q.eq('variant_id', variantId);
            const { data, error } = await q;
            if (error) throw error;
            return (data || []).reduce((s: number, i: any) => s + (i.quantity || 0), 0);
        },
        staleTime: 30000,
    });

    const filtered = filterType === 'pending_match'
        ? movements.filter(m => m.costMatchStatus === 'pending_match')
        : filterType
            ? movements.filter(m => m.sourceType === filterType)
            : movements;

    const sorted = [...filtered].sort((a: any, b: any) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        return ascending ? ta - tb : tb - ta;
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[80vh] max-h-[90vh] max-w-3xl flex-col">
                <DialogHeader>
                    <DialogTitle>庫存明細 - {name}</DialogTitle>
                    <DialogDescription>
                        進出貨記錄，包含採購入庫、出貨扣減、手動調整等
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center gap-2 mb-4 flex-wrap">
                    <span className="text-sm text-muted-foreground">篩選：</span>
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="h-8 rounded-md border border-input bg-background px-3 text-xs"
                    >
                        <option value="">全部</option>
                        <option value="purchase_receipt">採購入庫</option>
                        <option value="sales_shipment">出貨扣減</option>
                        <option value="sales_note_deletion">銷貨刪除回補</option>
                        <option value="manual_adjustment">手動調整</option>
                        <option value="pending_match">待配對（懸空）</option>
                    </select>
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setAscending(v => !v)}>
                        {ascending ? '時間正序 ↑' : '時間倒序 ↓'}
                    </Button>
                    <span className="text-xs text-muted-foreground ml-auto">
                        目前庫存：{currentStock ?? '-'}
                    </span>
                </div>

                <ScrollArea className="min-h-0 w-full flex-1">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="text-xs">時間</TableHead>
                                <TableHead className="text-xs text-right">異動</TableHead>
                                <TableHead className="text-xs text-right" title="該筆異動完成後的累計庫存（依時間順序）">當時餘額</TableHead>
                                <TableHead className="text-xs">來源</TableHead>
                                <TableHead className="text-xs">單號</TableHead>
                                <TableHead className="text-xs">備註</TableHead>
                                <TableHead className="text-xs">成本配對</TableHead>
                                <TableHead className="text-xs">採購單號</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">載入中...</TableCell>
                                </TableRow>
                            ) : sorted.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">暫無記錄</TableCell>
                                </TableRow>
                            ) : (
                                sorted.map((m: any) => (
                                    <TableRow key={m.id}>
                                        <TableCell className="text-xs whitespace-nowrap">
                                            {m.documentDate ? new Date(m.documentDate).toLocaleString() : (m.createdAt ? new Date(m.createdAt).toLocaleString() : '-')}
                                        </TableCell>
                                        <TableCell className={`text-xs text-right font-mono tabular-nums ${m.quantityChange > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {m.quantityChange > 0 ? '+' : ''}{m.quantityChange}
                                        </TableCell>
                                        <TableCell className="text-xs text-right font-mono tabular-nums">
                                            {m.balanceAfter}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            <Badge variant="outline" className="text-[10px] font-normal">
                                                {SOURCE_TYPE_LABELS[m.sourceType] || m.sourceType}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs font-mono">
                                            {m.referenceCode || '-'}
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">
                                            {m.note || '-'}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            <Badge variant="outline" className="text-[10px] font-normal">
                                                {costMatchLabel(m.costMatchStatus)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs font-mono">
                                            {m.purchaseOrderId ? <PoRemainingBadge purchaseOrderId={m.purchaseOrderId} variantId={m.variantId} /> : (m.purchaseOrderCode || '-')}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
}