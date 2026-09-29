import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, PackageSearch } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/formatters';

interface BatchRow {
    id: string;
    serial_number: string | null;
    batch_number: string | null;
    tracking_mode: string;
    quantity: number;
    unit_cost: number;
    status: string;
    received_at: string;
    purchase_order_id: string | null;
    variant?: {
        name: string;
        sku: string;
        product?: { name: string; code: string } | null;
    };
    purchase_order?: { supplier_order_number: string | null };
}

const TRACKING_LABELS: Record<string, string> = {
    serial: '序號',
    batch: '批號',
    none: '無追蹤',
};

export default function BatchesTab() {
    const [search, setSearch] = useState('');

    const { data: rows = [], isLoading } = useQuery({
        queryKey: ['product-batches'],
        queryFn: async () => {
            const { data, error } = await (supabase as any)
                .from('product_batches')
                .select('id, serial_number, batch_number, tracking_mode, quantity, unit_cost, status, received_at, purchase_order_id, variant:product_variants(id, name, sku, product:products(name, code)), purchase_order:purchase_orders(supplier_order_number)')
                .order('received_at', { ascending: false })
                .limit(500);
            if (error) throw error;
            return (data || []) as BatchRow[];
        },
    });

    const filtered = useMemo(() => {
        const kw = search.trim().toLowerCase();
        if (!kw) return rows;
        return rows.filter((r) => {
            const productName = r.variant?.name || r.variant?.product?.name || '';
            const productCode = r.variant?.product?.code || '';
            const sku = r.variant?.sku || '';
            const serial = r.serial_number || '';
            const batch = r.batch_number || '';
            return [productName, productCode, sku, serial, batch]
                .some((s) => s.toLowerCase().includes(kw));
        });
    }, [rows, search]);

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle className="text-base">批次 / 序號追蹤</CardTitle>
                <div className="relative w-72">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="搜尋商品、SKU、序號或批號..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-9"
                    />
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="text-xs">商品</TableHead>
                            <TableHead className="text-xs">追蹤模式</TableHead>
                            <TableHead className="text-xs">序號 / 批號</TableHead>
                            <TableHead className="text-xs text-right">數量</TableHead>
                            <TableHead className="text-xs text-right">單位成本</TableHead>
                            <TableHead className="text-xs">進貨日期</TableHead>
                            <TableHead className="text-xs">採購單號</TableHead>
                            <TableHead className="text-xs">狀態</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">載入中...</TableCell>
                            </TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">
                                    <PackageSearch className="h-8 w-8 mx-auto mb-1.5 text-muted-foreground/40" />
                                    {search ? '查無符合的批次 / 序號' : '尚未建立任何批次 / 序號'}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filtered.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="font-medium text-sm">{r.variant?.name || r.variant?.product?.name || '-'}</span>
                                            <span className="text-[10px] text-muted-foreground font-mono">{r.variant?.sku || ''}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={r.tracking_mode === 'serial' ? 'secondary' : 'outline'} className="text-[10px] font-normal">
                                            {TRACKING_LABELS[r.tracking_mode] || r.tracking_mode}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs font-mono">
                                        {r.serial_number || r.batch_number || '-'}
                                    </TableCell>
                                    <TableCell className="text-xs text-right font-mono tabular-nums">{r.quantity}</TableCell>
                                    <TableCell className="text-xs text-right">{formatCurrency(r.unit_cost)}</TableCell>
                                    <TableCell className="text-xs whitespace-nowrap">{formatDate(r.received_at) || '-'}</TableCell>
                                    <TableCell className="text-xs font-mono">
                                        {r.purchase_order?.supplier_order_number || (r.purchase_order_id ? r.purchase_order_id.slice(0, 8) : '-')}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{r.status}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}