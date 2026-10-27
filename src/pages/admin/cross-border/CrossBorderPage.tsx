import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Globe, Plus, Search, ArrowLeft, FileText, X, Trash2 } from 'lucide-react';

// ---- Types ----
interface LinkedPO {
  id: string;
  poCode: string;
  poDate: string;
  supplier: string;
  itemCount: number;
  totalQty: number;
  consolidationWeight: number | null;
  status: 'linked' | 'confirmed';
}

interface ConsolidationShipment {
  id: string;
  code: string;
  name: string;
  date: string;
  status: 'draft' | 'pending' | 'shipped' | 'received' | 'cancelled';
  createdBy: string;
  createdAt: string;
  warehouseName: string;
  customsClearanceNumber: string;
  shippingType: 'sea_fast' | 'sea' | 'air';
  linkedPOs: LinkedPO[];
  note: string;
  consolidationTotalWeight: number | null;  // 集運倉總重（使用者填入，價格依據）
  freightAmount: number | null;             // 運費金額（使用者填入）
  freightCurrency: string;
}

// ---- Mock Data ----
const MOCK_SHIPMENTS: ConsolidationShipment[] = [
  {
    id: 'cs-1', code: 'CON-20261026-001', name: '10月底深圳集運', date: '2026-10-26',
    status: 'shipped', createdBy: 'admin', createdAt: '2026-10-26 09:00',
    warehouseName: '深圳集運倉A', customsClearanceNumber: 'CCL-20261026-001', shippingType: 'sea_fast', note: '',
    consolidationTotalWeight: 12, freightAmount: 120, freightCurrency: 'TWD',
    linkedPOs: [
      { id: 'po-1', poCode: 'PO-20261020-001', poDate: '2026-10-20', supplier: '深圳電子', itemCount: 3, totalQty: 50, consolidationWeight: 3.4, status: 'confirmed' },
      { id: 'po-2', poCode: 'PO-20261021-002', poDate: '2026-10-21', supplier: '廣州配件', itemCount: 2, totalQty: 30, consolidationWeight: 2.3, status: 'confirmed' },
      { id: 'po-3', poCode: 'PO-20261022-003', poDate: '2026-10-22', supplier: '東莞塑膠', itemCount: 4, totalQty: 80, consolidationWeight: 6.0, status: 'linked' },
    ],
  },
  {
    id: 'cs-2', code: 'CON-20261020-002', name: '10月中深圳集運', date: '2026-10-20',
    status: 'received', createdBy: 'admin', createdAt: '2026-10-20 14:00',
    warehouseName: '深圳集運倉B', customsClearanceNumber: 'CCL-20261020-003', shippingType: 'air', note: '',
    consolidationTotalWeight: 15, freightAmount: 330, freightCurrency: 'TWD',
    linkedPOs: [
      { id: 'po-6', poCode: 'PO-20261015-006', poDate: '2026-10-15', supplier: '深圳電子', itemCount: 5, totalQty: 100, consolidationWeight: 15.0, status: 'confirmed' },
    ],
  },
  {
    id: 'cs-3', code: 'CON-20261015-003', name: '10月初集運', date: '2026-10-15',
    status: 'draft', createdBy: 'admin', createdAt: '2026-10-15 10:00',
    warehouseName: '', customsClearanceNumber: '', shippingType: 'sea_fast', note: '',
    consolidationTotalWeight: null, freightAmount: null, freightCurrency: 'TWD',
    linkedPOs: [],
  },
];

// POs are now fetched from real data (see useQuery below)

export default function CrossBorderPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isNew = searchParams.get('new') === '1';

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const { data: shipments = [], refetch: refetchShipments } = useQuery({
    queryKey: ['consolidation-shipments', searchQuery, statusFilter],
    queryFn: async () => {
      let q = (supabase as any).from('consolidation_shipments').select('*').order('created_at', { ascending: false });
      if (searchQuery.trim()) q = q.ilike('name', `%${searchQuery.trim()}%`);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      const result: ConsolidationShipment[] = [];
      for (const s of (data ?? [])) {
        const { data: pos } = await (supabase as any)
          .from('consolidation_shipment_pos')
          .select('*, purchase_orders(id, supplier_order_number, order_date, supplier_id, suppliers(name))')
          .eq('consolidation_shipment_id', s.id);
        const linkedPOs = (pos ?? []).map((p: any) => ({
          id: p.purchase_order_id,
          poCode: p.purchase_orders?.supplier_order_number || p.purchase_order_id.slice(0, 8),
          poDate: p.purchase_orders?.order_date || '',
          supplier: p.purchase_orders?.suppliers?.name || '未知',
          itemCount: 0,
          totalQty: 0,
          consolidationWeight: p.consolidation_weight,
          status: p.status || 'linked',
        }));
        result.push({
          id: s.id,
          code: s.code,
          name: s.name,
          date: s.date,
          status: s.status,
          createdBy: s.created_by || '',
          createdAt: s.created_at,
          warehouseName: s.warehouse_name || '',
          customsClearanceNumber: s.customs_clearance_number || '',
          shippingType: s.shipping_type || 'sea_fast',
          linkedPOs,
          note: s.note || '',
          consolidationTotalWeight: s.consolidation_total_weight,
          freightAmount: s.freight_amount,
          freightCurrency: s.freight_currency || 'TWD',
        });
      }
      return result;
    },
  });

  const { data: allPOs = [] } = useQuery({
    queryKey: ['cb-all-pos'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('id, supplier_id, supplier_order_number, order_date, status, total_amount, suppliers(name)')
        .neq('status', 'cancelled')
        .order('order_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      // Get item counts per PO
      const poIds = (data ?? []).map((p: any) => p.id);
      const { data: items } = await (supabase as any)
        .from('purchase_order_items')
        .select('purchase_order_id')
        .in('purchase_order_id', poIds);
      const itemCountMap: Record<string, number> = {};
      const qtyMap: Record<string, number> = {};
      for (const it of (items ?? [])) {
        itemCountMap[it.purchase_order_id] = (itemCountMap[it.purchase_order_id] || 0) + 1;
      }
      // Get quantities
      const { data: items2 } = await (supabase as any)
        .from('purchase_order_items')
        .select('purchase_order_id, quantity')
        .in('purchase_order_id', poIds);
      for (const it of (items2 ?? [])) {
        qtyMap[it.purchase_order_id] = (qtyMap[it.purchase_order_id] || 0) + (it.quantity || 0);
      }
      return (data ?? []).map((p: any) => ({
        id: p.id,
        poCode: p.supplier_order_number || p.id.slice(0, 8),
        poDate: p.order_date,
        supplier: p.suppliers?.name || '未知',
        itemCount: itemCountMap[p.id] || 0,
        totalQty: qtyMap[p.id] || 0,
        status: p.status,
      }));
    },
  });
  const [poSearch, setPoSearch] = useState('');

  const [editForm, setEditForm] = useState({
    name: '', date: new Date().toISOString().slice(0, 10),
    warehouseName: '', customsClearanceNumber: '', shippingType: 'sea_fast' as 'sea_fast' | 'sea' | 'air',
    status: 'draft' as ConsolidationShipment['status'], note: '',
    consolidationTotalWeight: '' as string,
    freightAmount: '' as string,
  });
  const [editLinkedPOs, setEditLinkedPOs] = useState<LinkedPO[]>([]);

  const selectedShipment = editId ? shipments.find(s => s.id === editId) || null : null;
  const isCreateMode = isNew || !editId;

  useMemo(() => {
    if (selectedShipment) {
      setEditForm({
        name: selectedShipment.name,
        date: selectedShipment.date,
        warehouseName: selectedShipment.warehouseName,
        customsClearanceNumber: selectedShipment.customsClearanceNumber,
        shippingType: selectedShipment.shippingType,
        status: selectedShipment.status,
        note: selectedShipment.note || '',
        consolidationTotalWeight: selectedShipment.consolidationTotalWeight != null ? String(selectedShipment.consolidationTotalWeight) : '',
        freightAmount: selectedShipment.freightAmount != null ? String(selectedShipment.freightAmount) : '',
      });
      setEditLinkedPOs([...selectedShipment.linkedPOs]);
    } else if (isNew) {
      setEditForm({ name: '', date: new Date().toISOString().slice(0, 10), warehouseName: '', customsClearanceNumber: '', shippingType: 'sea_fast', status: 'draft', note: '', consolidationTotalWeight: '', freightAmount: '' });
      setEditLinkedPOs([]);
    }
  }, [editId, isNew]);

  const filtered = useMemo(() => {
    let list = [...shipments];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(s => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.warehouseName.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') list = list.filter(s => s.status === statusFilter);
    return list;
  }, [shipments, searchQuery, statusFilter]);

  const handleSave = async () => {
    if (!editForm.name.trim()) { toast.error('請輸入集運單名稱'); return; }
    const ctw = editForm.consolidationTotalWeight ? Number(editForm.consolidationTotalWeight) : null;
    const fa = editForm.freightAmount ? Number(editForm.freightAmount) : null;
    if (ctw !== null && (Number.isNaN(ctw) || ctw < 0)) { toast.error('請輸入有效的集運倉總重'); return; }
    if (fa !== null && (Number.isNaN(fa) || fa < 0)) { toast.error('請輸入有效的運費金額'); return; }

    try {
      if (isCreateMode) {
        // 1. Create consolidation shipment
        const { data: createRes, error: createErr } = await (supabase as any).rpc('create_consolidation_shipment', {
          p_name: editForm.name,
          p_date: editForm.date,
          p_warehouse_name: editForm.warehouseName.trim() || null,
          p_customs_clearance_number: editForm.customsClearanceNumber.trim() || null,
          p_shipping_type: editForm.shippingType,
          p_note: editForm.note || null,
        });
        if (createErr) throw createErr;
        if (createRes?.ok === false) throw new Error(createRes.reason ?? '建立失敗');
        const newId = createRes.id;

        // 2. Add POs
        for (const po of editLinkedPOs) {
          const { data: addRes, error: addErr } = await (supabase as any).rpc('add_po_to_consolidation', {
            p_consolidation_shipment_id: newId,
            p_purchase_order_id: po.id,
            p_consolidation_weight: po.consolidationWeight,
          });
          if (addErr) throw addErr;
          if (addRes?.ok === false) throw new Error(addRes.reason ?? '關聯採購單失敗');
        }

        // 3. Update consolidation total weight and freight amount
        if (ctw != null || fa != null) {
          const { data: updRes, error: updErr } = await (supabase as any).rpc('update_consolidation_shipment', {
            p_id: newId,
            p_consolidation_total_weight: ctw,
            p_freight_amount: fa,
          });
          if (updErr) throw updErr;
          if (updRes?.ok === false) throw new Error(updRes.reason ?? '更新失敗');
        }

        toast.success('集運單已建立');
        setSearchParams({ edit: newId });
        queryClient.invalidateQueries({ queryKey: ['consolidation-shipments'] });
      } else {
        const target = selectedShipment;
        if (!target) return;

        // 1. Update consolidation shipment
        const { data: updRes, error: updErr } = await (supabase as any).rpc('update_consolidation_shipment', {
          p_id: target.id,
          p_name: editForm.name,
          p_date: editForm.date,
          p_warehouse_name: editForm.warehouseName.trim() || null,
          p_customs_clearance_number: editForm.customsClearanceNumber.trim() || null,
          p_shipping_type: editForm.shippingType,
          p_status: editForm.status,
          p_note: editForm.note || null,
          p_consolidation_total_weight: ctw,
          p_freight_amount: fa,
        });
        if (updErr) throw updErr;
        if (updRes?.ok === false) throw new Error(updRes.reason ?? '更新失敗');

        // 2. Sync POs: remove unlinked, add new
        const existingPoIds = target.linkedPOs.map((p: any) => p.id);
        const newPoIds = editLinkedPOs.map(p => p.id);
        for (const poId of existingPoIds) {
          if (!newPoIds.includes(poId)) {
            const { data: remRes, error: remErr } = await (supabase as any).rpc('remove_po_from_consolidation', {
              p_consolidation_shipment_id: target.id,
              p_purchase_order_id: poId,
            });
            if (remErr) throw remErr;
            if (remRes?.ok === false) throw new Error(remRes.reason ?? '解除關聯失敗');
          }
        }
        for (const po of editLinkedPOs) {
          const { data: addRes, error: addErr } = await (supabase as any).rpc('add_po_to_consolidation', {
            p_consolidation_shipment_id: target.id,
            p_purchase_order_id: po.id,
            p_consolidation_weight: po.consolidationWeight,
          });
          if (addErr) throw addErr;
          if (addRes?.ok === false) throw new Error(addRes.reason ?? '關聯採購單失敗');
        }

        toast.success('集運單已更新');
        queryClient.invalidateQueries({ queryKey: ['consolidation-shipments'] });
      }
    } catch (e: any) {
      toast.error(e.message || '操作失敗');
    }
  };


  const handleDelete = async (id: string) => {
    if (!window.confirm('確定要刪除此集運單嗎？（關聯的採購單將被釋放）')) return;
    try {
      const { data, error } = await (supabase as any).rpc('delete_consolidation_shipment', { p_id: id });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.reason ?? '刪除失敗');
      toast.success('集運單已刪除');
      queryClient.invalidateQueries({ queryKey: ['consolidation-shipments'] });
      if (editId === id) setSearchParams({});
    } catch (e: any) {
      toast.error(e.message || '刪除失敗');
    }
  };

  const handleAddPO = (po: any) => {
    if (editLinkedPOs.some(p => p.id === po.id)) { toast.error('此採購單已關聯'); return; }
    const linked: LinkedPO = { id: po.id, poCode: po.poCode, poDate: po.poDate, supplier: po.supplier, itemCount: po.itemCount, totalQty: po.totalQty, consolidationWeight: null, status: 'linked' };
    setEditLinkedPOs(prev => [...prev, linked]);
    toast.success('已關聯採購單');
  };

  const handleUnlinkPO = (poId: string) => {
    if (!window.confirm('確定要解除此採購單的關聯嗎？')) return;
    setEditLinkedPOs(prev => prev.filter(p => p.id !== poId));
    toast.success('已解除關聯');
  };

  const handleUpdatePOWeight = (poId: string, value: string) => {
    const v = value === '' ? null : Number(value);
    if (value !== '' && (Number.isNaN(v!) || v! < 0)) return;
    setEditLinkedPOs(prev => prev.map(p => p.id === poId ? { ...p, consolidationWeight: v } : p));
  };

  const statusLabel = (s: string) => ({ draft: '草稿', pending: '集運中', shipped: '已出倉', received: '已完成', cancelled: '已取消' }[s] ?? s);
  const statusVariant = (s: string): 'default' | 'secondary' | 'outline' | 'destructive' => ({ draft: 'secondary', pending: 'outline', shipped: 'default', received: 'default', cancelled: 'destructive' }[s] as any ?? 'secondary');

  const filteredPOs = poSearch.trim()
    ? (allPOs as any[]).filter((po: any) => po.poCode.toLowerCase().includes(poSearch.toLowerCase()) || po.supplier.toLowerCase().includes(poSearch.toLowerCase()))
    : (allPOs as any[]);

  const [addPoOpen, setAddPoOpen] = useState(false);

  // ---- Edit / Create view ----
  if (isNew || editId) {
    const totalConsolWeight = editLinkedPOs.reduce((s, po) => s + (po.consolidationWeight || 0), 0);
    const fa = editForm.freightAmount ? Number(editForm.freightAmount) : null;

    // 運費分攤邏輯計算
    const allocations = fa != null && totalConsolWeight > 0
      ? editLinkedPOs.map(po => {
        const w = po.consolidationWeight || 0;
        const raw = fa * (w / totalConsolWeight);
        const base = Math.floor(raw * 100) / 100;
        return { poId: po.id, weight: w, allocated: base, remainder: raw - base };
      })
      : [];
      
    if (allocations.length > 0 && fa != null) {
      const totalBase = allocations.reduce((s, a) => s + a.allocated, 0);
      const gap = Math.round((fa - totalBase) * 100);
      const order = allocations.map((_, i) => i).sort((a, b) => allocations[b].remainder - allocations[a].remainder);
      for (let k = 0; k < gap && k < order.length; k++) {
        allocations[order[k]].allocated = Math.round((allocations[order[k]].allocated + 0.01) * 100) / 100;
      }
    }

    const getAllocatedAmount = (poId: string) => {
      const found = allocations.find(a => a.poId === poId);
      return found ? found.allocated : 0;
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}><ArrowLeft className="h-4 w-4 mr-1" />返回列表</Button>
          <Globe className="h-6 w-6" />
          <h1 className="text-2xl font-bold">{isNew ? '新增集運單' : '編輯集運單'}</h1>
        </div>

        <Card>
          <CardHeader><CardTitle>集運單基本資料</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><Label>集運日期</Label><Input type="date" value={editForm.date} onChange={e => setEditForm(s => ({ ...s, date: e.target.value }))} /></div>
            <div><Label>集運單名稱/備註</Label><Input value={editForm.name} onChange={e => setEditForm(s => ({ ...s, name: e.target.value }))} placeholder="例如：10月底深圳集運" /></div>
            <div><Label>集運倉名稱</Label><Input value={editForm.warehouseName} onChange={e => setEditForm(s => ({ ...s, warehouseName: e.target.value }))} placeholder="例如：深圳集運倉A" /></div>
            <div><Label>清關單號</Label><Input value={editForm.customsClearanceNumber} onChange={e => setEditForm(s => ({ ...s, customsClearanceNumber: e.target.value }))} placeholder="CCL-20261026-001" /></div>
            <div><Label>運送類型</Label>
              <Select value={editForm.shippingType} onValueChange={v => setEditForm(s => ({ ...s, shippingType: v as 'sea_fast' | 'sea' | 'air' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sea_fast">海快 (參考 9/kg)</SelectItem>
                  <SelectItem value="sea">海運 (參考 7/kg)</SelectItem>
                  <SelectItem value="air">空運 (參考 22/kg)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>狀態</Label>
              <Select value={editForm.status} onValueChange={v => setEditForm(s => ({ ...s, status: v as ConsolidationShipment['status'] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">草稿</SelectItem>
                  <SelectItem value="pending">集運中</SelectItem>
                  <SelectItem value="shipped">已出倉</SelectItem>
                  <SelectItem value="received">已完成</SelectItem>
                  <SelectItem value="cancelled">已取消</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>備註</Label><Input value={editForm.note} onChange={e => setEditForm(s => ({ ...s, note: e.target.value }))} placeholder="選填" /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>運費設定</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>集運倉總重 (kg)</Label>
              <Input type="number" step="0.001" value={editForm.consolidationTotalWeight} onChange={e => setEditForm(s => ({ ...s, consolidationTotalWeight: e.target.value }))} placeholder="集運倉報的總重" />
            </div>
            <div>
              <Label>總運費金額</Label>
              <Input type="number" step="0.01" value={editForm.freightAmount} onChange={e => setEditForm(s => ({ ...s, freightAmount: e.target.value }))} placeholder="0.00" />
            </div>
            <div>
              <Label>參考費率</Label>
              <div className="h-10 flex items-center text-sm text-muted-foreground">
                {{ sea_fast: '海快 9/kg', sea: '海運 7/kg', air: '空運 22/kg' }[editForm.shippingType]}（僅參考）
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 合併後的採購單與分攤運費列表 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>採購單與運費分攤</CardTitle>
            <Button size="sm" onClick={() => { setPoSearch(''); setAddPoOpen(true); }}><Plus className="h-4 w-4 mr-1" />添加採購單</Button>
          </CardHeader>
          <CardContent>
            {editLinkedPOs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">尚未關聯任何採購單</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>採購單編號</TableHead>
                    <TableHead>採購日期</TableHead>
                    <TableHead>供應商</TableHead>
                    <TableHead className="text-right">項目數</TableHead>
                    <TableHead className="text-right">數量</TableHead>
                    <TableHead className="text-right">集運倉重量 (kg)</TableHead>
                    <TableHead className="text-right font-semibold text-primary">分攤運費</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {editLinkedPOs.map(po => {
                    const allocatedVal = getAllocatedAmount(po.id);
                    return (
                      <TableRow key={po.id}>
                        <TableCell className="font-medium">{po.poCode}</TableCell>
                        <TableCell>{po.poDate}</TableCell>
                        <TableCell>{po.supplier}</TableCell>
                        <TableCell className="text-right">{po.itemCount}</TableCell>
                        <TableCell className="text-right">{po.totalQty}</TableCell>
                        <TableCell className="text-right">
                          <Input type="number" step="0.1" className="h-7 w-20 text-right inline-block" value={po.consolidationWeight ?? ''} onChange={e => handleUpdatePOWeight(po.id, e.target.value)} placeholder="填入" />
                        </TableCell>
                        <TableCell className="text-right font-semibold text-primary">
                          $ {allocatedVal.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleUnlinkPO(po.id)}><X className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="font-medium bg-muted/30">
                    <TableCell colSpan={5}>合計</TableCell>
                    <TableCell className="text-right">{editLinkedPOs.reduce((s, po) => s + (po.consolidationWeight || 0), 0).toFixed(1)} kg</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      $ {allocations.reduce((s, a) => s + a.allocated, 0).toFixed(2)}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setSearchParams({})}>取消</Button>
          <Button onClick={handleSave}>儲存集運單</Button>
        </div>

        <Dialog open={addPoOpen} onOpenChange={setAddPoOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>添加採購單</DialogTitle><DialogDescription>搜尋並選擇要關聯到此集運單的採購單。</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={poSearch} onChange={e => setPoSearch(e.target.value)} placeholder="搜尋採購單編號、供應商..." className="pl-8" />
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>採購單編號</TableHead><TableHead>採購日期</TableHead><TableHead>供應商</TableHead><TableHead className="text-right">項目數</TableHead><TableHead className="text-right">數量</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredPOs.map(po => (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">{po.poCode}</TableCell>
                      <TableCell>{po.poDate}</TableCell>
                      <TableCell>{po.supplier}</TableCell>
                      <TableCell className="text-right">{po.itemCount}</TableCell>
                      <TableCell className="text-right">{po.totalQty}</TableCell>
                      <TableCell><Button size="sm" onClick={() => handleAddPO(po)}>關聯</Button></TableCell>
                    </TableRow>
                  ))}
                  {filteredPOs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">無可關聯的採購單</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ---- List view ----
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3"><Globe className="h-6 w-6" /><h1 className="text-2xl font-bold">集運倉管理</h1></div>
        <Button onClick={() => setSearchParams({ new: '1' })}><Plus className="h-4 w-4 mr-1" />新增集運單</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>集運單列表</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜尋集運單編號、名稱..." className="pl-8" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="狀態篩選" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="pending">集運中</SelectItem>
                <SelectItem value="shipped">已出倉</SelectItem>
                <SelectItem value="received">已完成</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>集運單編號</TableHead><TableHead>集運日期</TableHead><TableHead>集運單名稱/備註</TableHead><TableHead>集運倉名稱</TableHead><TableHead>清關單號</TableHead><TableHead>運送類型</TableHead><TableHead className="text-right">關聯採購單</TableHead><TableHead className="text-right">商品總數</TableHead><TableHead>狀態</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map(s => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => { setEditForm({ name: s.name, date: s.date, warehouseName: s.warehouseName, customsClearanceNumber: s.customsClearanceNumber, shippingType: s.shippingType, status: s.status, note: s.note || '', consolidationTotalWeight: s.consolidationTotalWeight != null ? String(s.consolidationTotalWeight) : '', freightAmount: s.freightAmount != null ? String(s.freightAmount) : '' }); setEditLinkedPOs([...s.linkedPOs]); setSearchParams({ edit: s.id }); }}>
                  <TableCell className="font-medium">{s.code}</TableCell>
                  <TableCell>{s.date}</TableCell>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>{s.warehouseName || '—'}</TableCell>
                  <TableCell>{s.customsClearanceNumber || '—'}</TableCell>
                  <TableCell>{{ sea_fast: '海快', sea: '海運', air: '空運' }[s.shippingType]}</TableCell>
                  <TableCell className="text-right">{s.linkedPOs.length}</TableCell>
                  <TableCell className="text-right">{s.linkedPOs.reduce((sum, po) => sum + po.itemCount, 0)}</TableCell>
                  <TableCell><Badge variant={statusVariant(s.status)}>{statusLabel(s.status)}</Badge></TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditForm({ name: s.name, date: s.date, warehouseName: s.warehouseName, customsClearanceNumber: s.customsClearanceNumber, shippingType: s.shippingType, status: s.status, note: s.note || '', consolidationTotalWeight: s.consolidationTotalWeight != null ? String(s.consolidationTotalWeight) : '', freightAmount: s.freightAmount != null ? String(s.freightAmount) : '' }); setEditLinkedPOs([...s.linkedPOs]); setSearchParams({ edit: s.id }); }}><FileText className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">尚無集運單</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}