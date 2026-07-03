import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save, Smartphone, Plus, Trash2, User, DollarSign } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRepairOrders, useRepairOrderItems } from '@/hooks/useRepairOrders';
import { useAuth } from '@/hooks/useAuth';
import { REPAIR_ORDER_STATUS_LABELS, RepairOrder, RepairOrderInsert, RepairOrderItemInsert } from '@/types/repair';
import { toast } from 'sonner';

interface DeviceModelOption {
  id: string;
  name: string;
  device_type: string | null;
  specifications: any;
  brand_name: string | null;
}

export default function AdminRepairOrderForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { currentStoreId } = useAuth();
  const isEdit = !!id;

  const { createMutation, updateMutation } = useRepairOrders(currentStoreId);

  const { data: deviceModels = [] } = useQuery({
    queryKey: ['device_models_list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('device_models')
        .select('*, device_brand:brand_id(name)')
        .order('name');
      return (data || []).map((m: any) => ({
        id: m.id,
        name: m.name,
        device_type: m.device_type,
        specifications: m.specifications,
        brand_name: m.device_brand?.name || null,
      })) as DeviceModelOption[];
    },
  });

  const { data: technicians = [] } = useQuery({
    queryKey: ['technicians'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name');
      return data || [];
    },
  });

  const [form, setForm] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    customer_notes: '',
    device_model_id: '',
    device_color: '',
    device_storage: '',
    device_ram: '',
    device_imei: '',
    device_sn: '',
    device_passcode: '',
    device_condition: '',
    reported_issue: '',
    diagnostic_result: '',
    internal_notes: '',
    status: 'pending',
    total_price: 0,
    discount: 0,
    deposit: 0,
    assigned_to: '',
    parts_cost: 0,
    labor_fee: 0,
  });

  const [items, setItems] = useState<{ id: string; item_type: 'service' | 'part'; service_name: string; part_name: string; quantity: number; unit_cost: number; unit_price: number; description: string }[]>([]);

  useEffect(() => {
    if (isEdit && id) {
      supabase.from('repair_orders').select('*').eq('id', id).single().then(({ data, error }) => {
        if (data) {
          setForm({
            customer_name: data.customer_name || '',
            customer_phone: data.customer_phone || '',
            customer_email: data.customer_email || '',
            customer_notes: data.customer_notes || '',
            device_model_id: data.device_model_id || '',
            device_color: data.device_color || '',
            device_storage: data.device_storage || '',
            device_ram: data.device_ram || '',
            device_imei: data.device_imei || '',
            device_sn: data.device_sn || '',
            device_passcode: data.device_passcode || '',
            device_condition: data.device_condition || '',
            reported_issue: data.reported_issue || '',
            diagnostic_result: data.diagnostic_result || '',
            internal_notes: data.internal_notes || '',
            status: data.status,
            total_price: data.total_price || 0,
            discount: data.discount || 0,
            deposit: data.deposit || 0,
            assigned_to: data.assigned_to || '',
            parts_cost: data.parts_cost || 0,
            labor_fee: data.labor_fee || 0,
          });
        }
      });
      supabase.from('repair_order_items').select('*').eq('repair_order_id', id).order('sort_order').then(({ data }) => {
        if (data) {
          setItems(data.map((i: any) => ({
            id: i.id,
            item_type: i.item_type,
            service_name: i.service_name || '',
            part_name: i.part_name || '',
            quantity: i.quantity,
            unit_cost: i.unit_cost || 0,
            unit_price: i.unit_price || 0,
            description: i.description || '',
          })));
        }
      });
    }
  }, [id, isEdit]);

  const selectedModel = deviceModels.find(m => m.id === form.device_model_id);

  const handleModelChange = (modelId: string) => {
    const model = deviceModels.find(m => m.id === modelId);
    setForm(prev => ({
      ...prev,
      device_model_id: modelId,
      device_color: '',
      device_storage: '',
      device_ram: '',
    }));
  };

  const addItem = () => {
    setItems(prev => [...prev, {
      id: crypto.randomUUID(),
      item_type: 'service',
      service_name: '',
      part_name: '',
      quantity: 1,
      unit_cost: 0,
      unit_price: 0,
      description: '',
    }]);
  };

  const updateItem = (itemId: string, field: string, value: any) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, [field]: value } : i));
  };

  const removeItem = (itemId: string) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
  };

  const calcTotals = () => {
    const partsCost = items.filter(i => i.item_type === 'part').reduce((s, i) => s + (i.unit_cost * i.quantity), 0);
    const laborFee = items.filter(i => i.item_type === 'service').reduce((s, i) => s + (i.unit_price * i.quantity), 0);
    const totalPrice = items.reduce((s, i) => s + (i.unit_price * i.quantity), 0);
    return { partsCost, laborFee, totalPrice };
  };

  const handleSubmit = async () => {
    if (!form.customer_name.trim()) {
      toast.error('請輸入客戶名稱');
      return;
    }

    const { partsCost, laborFee, totalPrice } = calcTotals();
    const payload = {
      ...form,
      store_id: currentStoreId || null,
      parts_cost: partsCost,
      labor_fee: laborFee,
      total_cost: partsCost,
      total_price: totalPrice - form.discount,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    };

    if (isEdit && id) {
      updateMutation.mutate(
        { id, values: payload },
        { onSuccess: () => navigate(`/admin/repair-orders/${id}`) }
      );
    } else {
      createMutation.mutate(payload as RepairOrderInsert, {
        onSuccess: async (data) => {
          if (items.length > 0) {
            const { error } = await supabase.from('repair_order_items').insert(
              items.map((item, idx) => ({
                repair_order_id: data.id,
                item_type: item.item_type,
                service_name: item.service_name || null,
                part_name: item.part_name || null,
                quantity: item.quantity,
                unit_cost: item.unit_cost,
                unit_price: item.unit_price,
                description: item.description || null,
                sort_order: idx,
              }))
            );
            if (error) toast.error('品項儲存失敗：' + error.message);
          }
          navigate(`/admin/repair-orders/${data.id}`);
        },
      });
    }
  };

  const { partsCost, laborFee, totalPrice } = calcTotals();
  const finalPrice = totalPrice - form.discount;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin/repair-orders')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {isEdit ? '編輯維修單' : '新增維修單'}
          </h1>
        </div>
        <Button onClick={handleSubmit}>
          <Save className="mr-2 h-4 w-4" />
          儲存
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                客戶資訊
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>客戶姓名 *</Label>
                <Input value={form.customer_name} onChange={(e) => setForm(prev => ({ ...prev, customer_name: e.target.value }))} placeholder="姓名" />
              </div>
              <div className="space-y-2">
                <Label>聯絡電話</Label>
                <Input value={form.customer_phone} onChange={(e) => setForm(prev => ({ ...prev, customer_phone: e.target.value }))} placeholder="0912-345-678" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={form.customer_email} onChange={(e) => setForm(prev => ({ ...prev, customer_email: e.target.value }))} placeholder="email@example.com" />
              </div>
              <div className="space-y-2">
                <Label>備註</Label>
                <Input value={form.customer_notes} onChange={(e) => setForm(prev => ({ ...prev, customer_notes: e.target.value }))} placeholder="客戶特殊需求" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Smartphone className="h-4 w-4" />
                裝置資訊
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>型號</Label>
                <Select value={form.device_model_id} onValueChange={handleModelChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="選擇型號..." />
                  </SelectTrigger>
                  <SelectContent>
                    {deviceModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.brand_name ? `${m.brand_name} ` : ''}{m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedModel?.specifications?.colors && (
                <div className="space-y-2">
                  <Label>顏色</Label>
                  <Select value={form.device_color} onValueChange={(v) => setForm(prev => ({ ...prev, device_color: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="選擇顏色..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectedModel.specifications.colors as string[]).map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!selectedModel?.specifications?.colors && (
                <div className="space-y-2">
                  <Label>顏色</Label>
                  <Input value={form.device_color} onChange={(e) => setForm(prev => ({ ...prev, device_color: e.target.value }))} placeholder="例: 太空黑" />
                </div>
              )}
              {selectedModel?.specifications?.storage_options ? (
                <div className="space-y-2">
                  <Label>儲存空間</Label>
                  <Select value={form.device_storage} onValueChange={(v) => setForm(prev => ({ ...prev, device_storage: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="選擇容量..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectedModel.specifications.storage_options as string[]).map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>儲存空間</Label>
                  <Input value={form.device_storage} onChange={(e) => setForm(prev => ({ ...prev, device_storage: e.target.value }))} placeholder="例: 256GB" />
                </div>
              )}
              <div className="space-y-2">
                <Label>RAM</Label>
                <Input value={form.device_ram} onChange={(e) => setForm(prev => ({ ...prev, device_ram: e.target.value }))} placeholder="例: 8GB" />
              </div>
              <div className="space-y-2">
                <Label>IMEI</Label>
                <Input value={form.device_imei} onChange={(e) => setForm(prev => ({ ...prev, device_imei: e.target.value }))} placeholder="IMEI 號碼" />
              </div>
              <div className="space-y-2">
                <Label>序號 (SN)</Label>
                <Input value={form.device_sn} onChange={(e) => setForm(prev => ({ ...prev, device_sn: e.target.value }))} placeholder="序號" />
              </div>
              <div className="space-y-2">
                <Label>密碼/解鎖碼</Label>
                <Input value={form.device_passcode} onChange={(e) => setForm(prev => ({ ...prev, device_passcode: e.target.value }))} placeholder="螢幕密碼" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>外觀狀況</Label>
                <Input value={form.device_condition} onChange={(e) => setForm(prev => ({ ...prev, device_condition: e.target.value }))} placeholder="例: 螢幕破裂、背蓋有刮痕" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">問題與診斷</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>客戶描述問題</Label>
                <Textarea value={form.reported_issue} onChange={(e) => setForm(prev => ({ ...prev, reported_issue: e.target.value }))} rows={3} placeholder="客戶描述的故障情況..." />
              </div>
              <div className="space-y-2">
                <Label>檢測結果</Label>
                <Textarea value={form.diagnostic_result} onChange={(e) => setForm(prev => ({ ...prev, diagnostic_result: e.target.value }))} rows={3} placeholder="工程師檢測結果..." />
              </div>
              <div className="space-y-2">
                <Label>內部備註</Label>
                <Textarea value={form.internal_notes} onChange={(e) => setForm(prev => ({ ...prev, internal_notes: e.target.value }))} rows={2} placeholder="不顯示在收據上的內部備註..." />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-4 w-4" />
                維修項目 / 零件用料
              </CardTitle>
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus className="h-4 w-4 mr-1" />
                新增項目
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">尚未新增維修項目或零件</p>
              )}
              {items.map((item, idx) => (
                <div key={item.id} className="flex items-start gap-2 p-3 border rounded-lg bg-muted/10">
                  <div className="grid grid-cols-12 gap-2 flex-1">
                    <div className="col-span-2">
                      <select
                        value={item.item_type}
                        onChange={(e) => updateItem(item.id, 'item_type', e.target.value)}
                        className="w-full text-xs px-2 py-1.5 border rounded-md bg-background"
                      >
                        <option value="service">維修服務</option>
                        <option value="part">零件材料</option>
                      </select>
                    </div>
                    <div className="col-span-3">
                      <Input
                        value={item.item_type === 'service' ? item.service_name : item.part_name}
                        onChange={(e) => updateItem(item.id, item.item_type === 'service' ? 'service_name' : 'part_name', e.target.value)}
                        placeholder={item.item_type === 'service' ? '服務名稱' : '零件名稱'}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="col-span-3">
                      <Input
                        value={item.description}
                        onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                        placeholder="描述"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="col-span-1">
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.id, 'quantity', parseInt(e.target.value) || 1)}
                        min={1}
                        className="h-9 text-sm text-center"
                      />
                    </div>
                    <div className="col-span-1">
                      <Input
                        type="number"
                        value={item.unit_cost}
                        onChange={(e) => updateItem(item.id, 'unit_cost', parseFloat(e.target.value) || 0)}
                        placeholder="成本"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="col-span-1">
                      <Input
                        type="number"
                        value={item.unit_price}
                        onChange={(e) => updateItem(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                        placeholder="售價"
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="col-span-1 flex items-center justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeItem(item.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">狀態與指派</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>狀態</Label>
                <Select value={form.status} onValueChange={(v) => setForm(prev => ({ ...prev, status: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REPAIR_ORDER_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>指派技師</Label>
                <Select value={form.assigned_to} onValueChange={(v) => setForm(prev => ({ ...prev, assigned_to: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="選擇技師..." />
                  </SelectTrigger>
                  <SelectContent>
                    {technicians.map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.full_name || t.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">費用摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">零件成本</span>
                <span className="font-mono">${partsCost.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">工資收入</span>
                <span className="font-mono">${laborFee.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">折扣</span>
                <Input
                  type="number"
                  value={form.discount}
                  onChange={(e) => setForm(prev => ({ ...prev, discount: parseFloat(e.target.value) || 0 }))}
                  className="w-24 h-7 text-right text-sm"
                />
              </div>
              <hr />
              <div className="flex justify-between font-semibold">
                <span>應收總額</span>
                <span className="font-mono text-lg">${finalPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">利潤 (估)</span>
                <span className={`font-mono ${finalPrice - partsCost >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ${(finalPrice - partsCost).toLocaleString()}
                </span>
              </div>
              <div className="space-y-2 pt-2">
                <Label>已收定金</Label>
                <Input
                  type="number"
                  value={form.deposit}
                  onChange={(e) => setForm(prev => ({ ...prev, deposit: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </CardContent>
          </Card>

          {isEdit && (
            <Button variant="outline" className="w-full" onClick={() => navigate(`/admin/repair-orders/${id}`)}>
              檢視詳細
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
