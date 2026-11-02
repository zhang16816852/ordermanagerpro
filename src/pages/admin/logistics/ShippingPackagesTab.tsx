import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Truck, Search, Filter, ClipboardPaste, CheckCircle2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/formatters';
import { format } from 'date-fns';
import { EntryDialog } from '@/pages/admin/accounting/components/EntryDialog';
import { useShippingSettlement } from '@/hooks/useShippingSettlement';
import { Account, AccountingCategory } from '@/pages/admin/accounting/types';

interface PastePreviewItem {
  trackingNumber: string;
  newCost: number;
  matched: ShipmentRow[];
  notFound: boolean;
}

interface ShipmentRow {
  id: string;
  docType: string;
  docCode: string;
  methodTitle: string;
  methodCode: string;
  feePayment: string;
  cost: number;
  fee: number;
  trackingNumber: string | null;
  shippedAt: string | null;
  supplierId: string | null;
  supplierName: string | null;
  isSettled: boolean;
}

export default function ShippingPackagesTab({ embedded = false }: { embedded?: boolean }) {
  const { settleMutation } = useShippingSettlement();
  const queryClient = useQueryClient();
  const [settleDialogOpen, setSettleDialogOpen] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState('__all__');
  const [feePaymentFilter, setFeePaymentFilter] = useState('__all__');
  const [settledFilter, setSettledFilter] = useState('__all__');
  const [search, setSearch] = useState('');
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pastePreview, setPastePreview] = useState<PastePreviewItem[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['shipping-packages-accounts'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounts')
        .select('id, name, currency, balance')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: categories = [] } = useQuery<AccountingCategory[]>({
    queryKey: ['shipping-packages-categories'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('accounting_categories')
        .select('id, name, type, description, is_active')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: suppliers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['shipping-packages-suppliers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('id, name')
        .eq('is_logistics_company', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: shipments = [], isLoading } = useQuery<ShipmentRow[]>({
    queryKey: ['shipping-packages-all'],
    queryFn: async () => {
      // Fetch all shipments with delivery method + supplier info
      const { data: shipRows, error: shipErr } = await (supabase as any)
        .from('shipments')
        .select(`
          id, doc_type, doc_id, delivery_method_id, delivery_method_code,
          delivery_method_title, fee, cost, fee_payment, tracking_number,
          shipped_at, delivery_methods(supplier_id, suppliers(name))
        `)
        .order('shipped_at', { ascending: false, nullsFirst: false });
      if (shipErr) throw shipErr;

      // Fetch doc codes
      const orderIds = (shipRows || []).filter((s: any) => s.doc_type === 'order').map((s: any) => s.doc_id);
      const salesNoteIds = (shipRows || []).filter((s: any) => s.doc_type === 'sales_note').map((s: any) => s.doc_id);
      const consignmentIds = (shipRows || []).filter((s: any) => s.doc_type === 'consignment_order').map((s: any) => s.doc_id);

      const codeMap: Record<string, string> = {};
      if (orderIds.length > 0) {
        const { data } = await (supabase as any).from('orders').select('id, code').in('id', orderIds);
        (data || []).forEach((d: any) => { codeMap[d.id] = d.code; });
      }
      if (salesNoteIds.length > 0) {
        const { data } = await (supabase as any).from('sales_notes').select('id, code').in('id', salesNoteIds);
        (data || []).forEach((d: any) => { codeMap[d.id] = d.code; });
      }
      if (consignmentIds.length > 0) {
        const { data } = await (supabase as any).from('consignment_orders').select('id, code').in('id', consignmentIds);
        (data || []).forEach((d: any) => { codeMap[d.id] = d.code; });
      }

      // Fetch settled shipment IDs
      const { data: settledRefs } = await (supabase as any)
        .from('accounting_entry_references')
        .select('reference_id, entry_id')
        .eq('reference_type', 'shipment');
      const settledEntryIds = (settledRefs || []).map((r: any) => r.entry_id);
      let settledPeriodEntryIds = new Set<string>();
      if (settledEntryIds.length > 0) {
        const { data: periods } = await (supabase as any)
          .from('shipping_settlement_periods')
          .select('entry_id')
          .eq('is_settled', true)
          .in('entry_id', settledEntryIds);
        settledPeriodEntryIds = new Set((periods || []).map((p: any) => p.entry_id));
      }
      const settledShipmentIds = new Set(
        (settledRefs || [])
          .filter((r: any) => settledPeriodEntryIds.has(r.entry_id))
          .map((r: any) => r.reference_id)
      );

      return (shipRows || []).map((s: any) => ({
        id: s.id,
        docType: s.doc_type,
        docCode: codeMap[s.doc_id] || s.doc_id?.slice(0, 8) || '—',
        methodTitle: s.delivery_method_title || s.delivery_method_code || '—',
        methodCode: s.delivery_method_code || '',
        feePayment: s.fee_payment || 'one_time',
        cost: Number(s.cost) || 0,
        fee: Number(s.fee) || 0,
        trackingNumber: s.tracking_number || null,
        shippedAt: s.shipped_at || null,
        supplierId: s.delivery_methods?.supplier_id || null,
        supplierName: s.delivery_methods?.suppliers?.name || null,
        isSettled: settledShipmentIds.has(s.id),
      }));
    },
  });

  const filtered = useMemo(() => {
    let list = shipments;
    if (supplierFilter !== '__all__') {
      list = list.filter(s => s.supplierId === supplierFilter);
    }
    if (feePaymentFilter !== '__all__') {
      list = list.filter(s => s.feePayment === feePaymentFilter);
    }
    if (settledFilter === 'settled') {
      list = list.filter(s => s.isSettled);
    } else if (settledFilter === 'unsettled') {
      list = list.filter(s => !s.isSettled);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(s =>
        s.docCode.toLowerCase().includes(q) ||
        (s.trackingNumber || '').toLowerCase().includes(q) ||
        (s.supplierName || '').toLowerCase().includes(q) ||
        s.methodTitle.toLowerCase().includes(q)
      );
    }
    return list;
  }, [shipments, supplierFilter, feePaymentFilter, settledFilter, search]);

  const expenseCategoryId = useMemo(
    () => categories.find(c => c.type === 'expense' && c.name.includes('運'))?.id
      || categories.find(c => c.type === 'expense')?.id
      || '',
    [categories],
  );

  const unsettledMonthly = filtered.filter(s => !s.isSettled && s.feePayment === 'monthly');

  // 解析貼上文字並匹配包裹
  const handleParsePaste = () => {
    const lines = pasteText.split(/\n/).map(l => l.trim()).filter(Boolean);
    const items: PastePreviewItem[] = [];
    for (const line of lines) {
      // 支援空格、逗號、Tab 分隔
      const parts = line.split(/[\s,，\t]+/).filter(Boolean);
      if (parts.length < 2) continue;
      const trackingNumber = parts[0];
      const newCost = parseFloat(parts[1]);
      if (isNaN(newCost)) continue;
      const matched = shipments.filter(s => s.trackingNumber === trackingNumber);
      items.push({
        trackingNumber,
        newCost,
        matched,
        notFound: matched.length === 0,
      });
    }
    setPastePreview(items);
  };

  // 批次更新成本
  const handleUpdateCosts = async () => {
    setIsUpdating(true);
    try {
      const updates = pastePreview.filter(p => !p.notFound);
      for (const item of updates) {
        for (const shipment of item.matched) {
          const { error } = await (supabase as any)
            .from('shipments')
            .update({ cost: item.newCost })
            .eq('id', shipment.id);
          if (error) throw error;
        }
      }
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['shipping-packages-all'] });
      setPasteDialogOpen(false);
      setPasteText('');
      setPastePreview([]);
    } catch (err) {
      console.error('Update failed:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6 pb-10">
      {embedded ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-blue-500" /> 所有包裹列表
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋單據編號、追蹤號碼、物流公司..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="物流公司" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部物流公司</SelectItem>
            {suppliers.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={feePaymentFilter} onValueChange={setFeePaymentFilter}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="結算方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部</SelectItem>
            <SelectItem value="monthly">月結</SelectItem>
            <SelectItem value="one_time">單次</SelectItem>
          </SelectContent>
        </Select>
        <Select value={settledFilter} onValueChange={setSettledFilter}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="結算狀態" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部</SelectItem>
            <SelectItem value="unsettled">未結算</SelectItem>
            <SelectItem value="settled">已結算</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setPasteDialogOpen(true)}>
          <ClipboardPaste className="h-4 w-4 mr-1" /> 貼上更新成本
        </Button>
        <Button size="sm" onClick={() => setSettleDialogOpen(true)}>
          <Filter className="h-4 w-4 mr-1" /> 運費結帳
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8">載入中...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">無符合條件的包裹</p>
          ) : (
            <div className="overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>物流公司</TableHead>
                    <TableHead>來源</TableHead>
                    <TableHead>單據</TableHead>
                    <TableHead>配送方式</TableHead>
                    <TableHead>結算</TableHead>
                    <TableHead className="text-right">成本</TableHead>
                    <TableHead>出貨時間</TableHead>
                    <TableHead>追蹤號碼</TableHead>
                    <TableHead className="text-center">狀態</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm">{s.supplierName || '—'}</TableCell>
                      <TableCell className="text-xs">
                        {s.docType === 'order' ? '訂單' : s.docType === 'sales_note' ? '銷貨單' : s.docType === 'consignment_order' ? '寄賣單' : s.docType}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{s.docCode}</TableCell>
                      <TableCell className="text-sm">{s.methodTitle}</TableCell>
                      <TableCell className="text-sm">
                        {s.feePayment === 'monthly' ? '月結' : '單次'}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {formatCurrency(s.cost)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {s.shippedAt ? format(new Date(s.shippedAt), 'yyyy/MM/dd HH:mm') : '—'}
                      </TableCell>
                      <TableCell className="text-xs">{s.trackingNumber || '—'}</TableCell>
                      <TableCell className="text-center">
                        {s.isSettled ? (
                          <Badge variant="secondary" className="text-emerald-600">已結算</Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600">未結算</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="mt-2 text-xs text-muted-foreground">
            共 {filtered.length} 筆包裹（篩選後）/ {shipments.length} 筆（全部）
            {unsettledMonthly.length > 0 && ` · ${unsettledMonthly.length} 筆月結未結算`}
          </div>
        </CardContent>
      </Card>

      {/* 結帳 Dialog */}
      <EntryDialog
        open={settleDialogOpen}
        onOpenChange={(o) => setSettleDialogOpen(o)}
        categories={categories}
        accounts={accounts}
        isLoading={settleMutation.isPending}
        prefill={{
          shipping: {},
          transactionDate: format(new Date(), 'yyyy-MM-dd'),
          description: '運費月結支出',
          categoryId: expenseCategoryId || undefined,
        }}
        onSubmit={() => {}}
        onShippingSettleSubmit={(payload) => settleMutation.mutate(payload, {
          onSuccess: () => setSettleDialogOpen(false),
        })}
      />

      {/* 貼上更新成本 Dialog */}
      <Dialog open={pasteDialogOpen} onOpenChange={(o) => { setPasteDialogOpen(o); if (!o) { setPasteText(''); setPastePreview([]); } }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>貼上物流單號與成本</DialogTitle>
            <DialogDescription>
              每行格式：物流單號 金額（支援空格、逗號、Tab 分隔）。金額為成本。貼上後預覽，確認後批次更新。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder={"4439711065 110\n4439711194,105\n4439711032  120"}
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={6}
              className="font-mono text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleParsePaste} disabled={!pasteText.trim()}>
                解析預覽
              </Button>
              {pastePreview.length > 0 && (
                <span className="text-sm text-muted-foreground self-center">
                  {pastePreview.filter(p => !p.notFound).length} 筆匹配，
                  {pastePreview.filter(p => p.notFound).length} 筆未找到
                </span>
              )}
            </div>

            {pastePreview.length > 0 && (
              <div className="border rounded-md overflow-auto max-h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>物流單號</TableHead>
                      <TableHead>日期</TableHead>
                      <TableHead>店家</TableHead>
                      <TableHead>單號</TableHead>
                      <TableHead className="text-right">原成本</TableHead>
                      <TableHead className="text-right">新成本</TableHead>
                      <TableHead className="text-center">狀態</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pastePreview.map((p, idx) => (
                      p.notFound ? (
                        <TableRow key={idx} className="bg-destructive/10">
                          <TableCell className="font-mono text-xs">{p.trackingNumber}</TableCell>
                          <TableCell colSpan={5} className="text-sm text-destructive">
                            未找到匹配的包裹
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-destructive">未找到</Badge>
                          </TableCell>
                        </TableRow>
                      ) : (
                        p.matched.map((s, mi) => (
                          <TableRow key={`${idx}-${mi}`}>
                            <TableCell className="font-mono text-xs">{p.trackingNumber}</TableCell>
                            <TableCell className="text-xs">
                              {s.shippedAt ? format(new Date(s.shippedAt), 'yyyy/MM/dd') : '—'}
                            </TableCell>
                            <TableCell className="text-sm">{s.supplierName || '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{s.docCode}</TableCell>
                            <TableCell className="text-right text-sm">{formatCurrency(s.cost)}</TableCell>
                            <TableCell className="text-right text-sm font-medium">{formatCurrency(p.newCost)}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="secondary" className="text-emerald-600">
                                <CheckCircle2 className="h-3 w-3 mr-1" />匹配
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPasteDialogOpen(false); setPasteText(''); setPastePreview([]); }}>
              取消
            </Button>
            <Button
              disabled={pastePreview.filter(p => !p.notFound).length === 0 || isUpdating}
              onClick={handleUpdateCosts}
            >
              {isUpdating ? '更新中...' : `更新 ${pastePreview.filter(p => !p.notFound).reduce((s, p) => s + p.matched.length, 0)} 筆`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}