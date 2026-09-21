import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/PageHeader';
import { PlusCircle, Pencil, Trash2, Truck, Store } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { useDeliveryMethods, getDeliveryMethodTypeLabel, type DeliveryMethodOption } from '@/components/shipping/DeliveryMethodPicker';

const TYPE_GROUPS: Array<{ type: string; label: string; hint: string }> = [
  { type: 'delivery', label: '送貨', hint: '店家/我方自行送貨，不需綁定物流供應商' },
  { type: 'logistics', label: '物流', hint: '委由物流公司（必須選擇物流供應商）' },
  { type: 'pickup', label: '自取', hint: '客戶自行取貨，一般無運費' },
];

interface MethodForm {
  id: string | null;
  code: string;
  name: string;
  type: string;
  supplier_id: string | null;
  price: string;
  cost: string;
  fee_payment: string;
  tracking_url_template: string;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

const EMPTY_FORM: MethodForm = {
  id: null, code: '', name: '', type: 'delivery', supplier_id: null,
  price: '', cost: '', fee_payment: 'one_time', tracking_url_template: '',
  is_default: false, is_active: true, sort_order: 0,
};

export default function DeliveryMethodsPage({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const { data: methods = [], isLoading } = useDeliveryMethods({ includeInactive: true });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MethodForm>(EMPTY_FORM);

  const { data: logisticsSuppliers = [] } = useQuery<any[]>({
    queryKey: ['delivery-methods-logistics-suppliers'],
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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['delivery-methods'] });
    queryClient.invalidateQueries({ queryKey: ['delivery-method-options'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: MethodForm) => {
      const base: Record<string, unknown> = {
        code: payload.code.trim(),
        name: payload.name.trim(),
        type: payload.type,
        supplier_id: payload.type === 'logistics' ? payload.supplier_id : null,
        price: payload.price === '' ? 0 : Number(payload.price),
        cost: payload.cost === '' ? 0 : Number(payload.cost),
        fee_payment: payload.fee_payment,
        tracking_url_template: payload.tracking_url_template.trim() || null,
        is_default: payload.is_default,
        is_active: payload.is_active,
        sort_order: payload.sort_order,
      };
      const isDefaultChanged = payload.is_default && !methods.find(m => m.id === payload.id)?.is_default;
      if (payload.id) {
        if (isDefaultChanged) {
          const { error: resetErr } = await (supabase as any)
            .from('delivery_methods')
            .update({ is_default: false })
            .neq('id', payload.id);
          if (resetErr) throw resetErr;
        }
        const { error } = await (supabase as any)
          .from('delivery_methods')
          .update(base)
          .eq('id', payload.id);
        if (error) throw error;
      } else {
        if (payload.is_default) {
          const { error: resetErr } = await (supabase as any)
            .from('delivery_methods')
            .update({ is_default: false })
            .neq('id', '00000000-0000-0000-0000-000000000000');
          if (resetErr) throw resetErr;
        }
        const { error } = await (supabase as any)
          .from('delivery_methods')
          .insert(base);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('delivery_methods')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });

  const grouped = useMemo(() => {
    return TYPE_GROUPS.map(g => ({
      ...g,
      items: methods
        .filter(m => m.type === g.type)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    })).filter(g => g.items.length > 0);
  }, [methods]);

  const openCreate = (type: string) => {
    const maxSort = methods.filter(m => m.type === type).reduce((s, m) => Math.max(s, m.sort_order || 0), 0);
    setForm({ ...EMPTY_FORM, type, sort_order: maxSort + 1 });
    setDialogOpen(true);
  };

  const openEdit = (m: DeliveryMethodOption) => {
    setForm({
      id: m.id,
      code: m.code,
      name: m.name,
      type: m.type,
      supplier_id: m.supplier_id,
      price: String(m.price ?? ''),
      cost: String(m.cost ?? ''),
      fee_payment: m.fee_payment,
      tracking_url_template: m.tracking_url_template || '',
      is_default: m.is_default,
      is_active: m.is_active,
      sort_order: m.sort_order,
    });
    setDialogOpen(true);
  };

  const isFormValid = form.name.trim() && form.code.trim() && (form.type !== 'logistics' || form.supplier_id);

  return (
    <div className="space-y-6 pb-10">
      {embedded ? (
        <div className="flex flex-wrap justify-end gap-2">
          {TYPE_GROUPS.map(g => (
            <Button key={g.type} size="sm" variant="outline" onClick={() => openCreate(g.type)}>
              <PlusCircle className="h-4 w-4 mr-1" /> 新增{g.label}
            </Button>
          ))}
        </div>
      ) : (
        <PageHeader
          title="配送方式管理"
          subtitle="管理送貨／物流／自取三類配送方式與實收／成本定價（包裹級 shipments 依此建立）"
          icon={<Truck className="h-5 w-5 text-blue-500" />}
          actions={
            <div className="flex gap-2">
              {TYPE_GROUPS.map(g => (
                <Button key={g.type} size="sm" variant="outline" onClick={() => openCreate(g.type)}>
                  <PlusCircle className="h-4 w-4 mr-1" /> 新增{g.label}
                </Button>
              ))}
            </div>
          }
        />
      )}

      {isLoading ? (
        <p className="text-center text-muted-foreground py-12">載入中...</p>
      ) : methods.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground py-10">
            尚無任何配送方式，請點上方「新增」開始建立。
          </CardContent>
        </Card>
      ) : (
        grouped.map(group => (
          <Card key={group.type}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {group.type === 'pickup' ? <Store className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                  {group.label}
                  <Badge variant="secondary" className="ml-1">{group.items.length}</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{group.hint}</p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>代碼</TableHead>
                      <TableHead>名稱</TableHead>
                      <TableHead>物流公司</TableHead>
                      <TableHead className="text-right">實收單價</TableHead>
                      <TableHead className="text-right">物流成本</TableHead>
                      <TableHead>結算方式</TableHead>
                      <TableHead className="text-center">預設</TableHead>
                      <TableHead className="text-center">啟用</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.code}</TableCell>
                        <TableCell className="font-medium text-sm">{m.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {m.supplier_id
                            ? (logisticsSuppliers.find(s => s.id === m.supplier_id)?.name || '物流商')
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(m.price)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{formatCurrency(m.cost)}</TableCell>
                        <TableCell className="text-sm">
                          {m.fee_payment === 'monthly' ? '月結' : '單次'}
                        </TableCell>
                        <TableCell className="text-center">
                          {m.is_default ? <Badge className="bg-amber-500">預設</Badge> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {m.is_active ? <Badge variant="secondary" className="text-emerald-600">啟用</Badge> : <Badge variant="outline" className="text-muted-foreground">停用</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="編輯" onClick={() => openEdit(m)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="刪除"
                              onClick={() => {
                                if (window.confirm(`確定刪除配送方式「${m.name}」？若已被單據引用將無法刪除。`)) {
                                  deleteMutation.mutate(m.id);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? '編輯配送方式' : `新增${getDeliveryMethodTypeLabel(form.type)}方式`}</DialogTitle>
            <DialogDescription>
              {form.type === 'logistics'
                ? '物流方式必須綁定物流供應商（is_logistics_company=true 的供應商）。'
                : form.type === 'delivery'
                  ? '自行送貨不綁定供應商，實收單價可自由設定。'
                  : '自取方式一般不收運費。'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>配送類型</Label>
                <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v, supplier_id: v === 'logistics' ? f.supplier_id : null }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_GROUPS.map(g => (
                      <SelectItem key={g.type} value={g.type}>{g.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>代碼（code，唯一）</Label>
                <Input value={form.code} onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))} placeholder="如 POST-5KG" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>名稱</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="如 郵局 - 本島 / 5公斤以下" />
            </div>
            {form.type === 'logistics' && (
              <div className="space-y-1.5">
                <Label>物流供應商</Label>
                <Select value={form.supplier_id || undefined} onValueChange={(v) => setForm(f => ({ ...f, supplier_id: v }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="選擇物流供應商" />
                  </SelectTrigger>
                  <SelectContent>
                    {logisticsSuppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>實收單價（客人付）</Label>
                <Input
                  type="number" min={0} value={form.price}
                  onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>物流成本（結帳用）</Label>
                <Input
                  type="number" min={0} value={form.cost}
                  onChange={(e) => setForm(f => ({ ...f, cost: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>追蹤網址模板（以 tracking_number 佔位符替換）</Label>
              <Input
                value={form.tracking_url_template}
                onChange={(e) => setForm(f => ({ ...f, tracking_url_template: e.target.value }))}
                placeholder="https://post.gov.tw/...?id={tracking_number}"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>結算方式</Label>
                <Select value={form.fee_payment} onValueChange={(v) => setForm(f => ({ ...f, fee_payment: v }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">單次</SelectItem>
                    <SelectItem value="monthly">月結</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>排序</Label>
                <Input type="number" value={form.sort_order} onChange={(e) => setForm(f => ({ ...f, sort_order: Number(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="flex items-center gap-6 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.is_default} onCheckedChange={(v) => setForm(f => ({ ...f, is_default: !!v }))} />
                設為預設
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm(f => ({ ...f, is_active: v }))} />
                啟用
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button
              disabled={!isFormValid || saveMutation.isPending}
              onClick={() => saveMutation.mutate(form)}
            >
              {saveMutation.isPending ? '儲存中...' : '儲存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}