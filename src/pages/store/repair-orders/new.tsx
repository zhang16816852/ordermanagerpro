import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save, Smartphone, Plus, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRepairOrders } from '@/hooks/useRepairOrders';
import { useAuth } from '@/hooks/useAuth';
import { RepairOrderInsert } from '@/types/repair';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

export default function StoreRepairOrderForm() {
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
        specifications: m.specifications,
        brand_name: m.device_brand?.name || null,
      }));
    },
  });

  const [form, setForm] = useState({
    customer_name: '',
    customer_phone: '',
    device_model_id: '',
    device_color: '',
    device_storage: '',
    device_imei: '',
    device_passcode: '',
    device_condition: '',
    reported_issue: '',
    total_price: 0,
    deposit: 0,
    status: 'pending',
  });

  const [items, setItems] = useState<{ id: string; service_name: string; part_name: string; quantity: number; unit_price: number }[]>([]);

  useEffect(() => {
    if (isEdit && id) {
      supabase.from('repair_orders').select('*').eq('id', id).single().then(({ data }) => {
        if (data) {
          setForm({
            customer_name: data.customer_name || '',
            customer_phone: data.customer_phone || '',
            device_model_id: data.device_model_id || '',
            device_color: data.device_color || '',
            device_storage: data.device_storage || '',
            device_imei: data.device_imei || '',
            device_passcode: data.device_passcode || '',
            device_condition: data.device_condition || '',
            reported_issue: data.reported_issue || '',
            total_price: data.total_price || 0,
            deposit: data.deposit || 0,
            status: data.status,
          });
        }
      });
      supabase.from('repair_order_items').select('*').eq('repair_order_id', id).order('sort_order').then(({ data }) => {
        if (data) {
          setItems(data.map((i: any) => ({
            id: i.id,
            service_name: i.service_name || '',
            part_name: i.part_name || '',
            quantity: i.quantity,
            unit_price: i.unit_price || 0,
          })));
        }
      });
    }
  }, [id, isEdit]);

  const addItem = () => {
    setItems(prev => [...prev, { id: crypto.randomUUID(), service_name: '', part_name: '', quantity: 1, unit_price: 0 }]);
  };

  const removeItem = (itemId: string) => {
    setItems(prev => prev.filter(i => i.id !== itemId));
  };

  const totalPrice = items.reduce((s, i) => s + (i.unit_price * i.quantity), 0);

  const handleSubmit = async () => {
    if (!form.customer_name.trim()) {
      toast.error('請輸入客戶名稱');
      return;
    }
    const payload = {
      customer_name: form.customer_name,
      customer_phone: form.customer_phone || null,
      device_model_id: form.device_model_id || null,
      device_color: form.device_color || null,
      device_storage: form.device_storage || null,
      device_imei: form.device_imei || null,
      device_passcode: form.device_passcode || null,
      device_condition: form.device_condition || null,
      reported_issue: form.reported_issue || null,
      total_price: totalPrice,
      deposit: form.deposit || 0,
      status: form.status,
      store_id: currentStoreId || null,
    };

    if (isEdit && id) {
      updateMutation.mutate(
        { id, values: payload },
        { onSuccess: () => navigate(`/dashboard/repair-orders/${id}`) }
      );
    } else {
      createMutation.mutate(payload as RepairOrderInsert, {
        onSuccess: async (data) => {
          if (items.length > 0) {
            await supabase.from('repair_order_items').insert(
              items.map((item, idx) => ({
                repair_order_id: data.id,
                item_type: 'service',
                service_name: item.service_name || null,
                part_name: item.part_name || null,
                quantity: item.quantity,
                unit_price: item.unit_price,
                sort_order: idx,
              }))
            );
          }
          navigate(`/dashboard/repair-orders/${data.id}`);
        },
      });
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard/repair-orders')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{isEdit ? '編輯維修單' : '新增維修單'}</h1>
        </div>
        <Button onClick={handleSubmit}>
          <Save className="mr-2 h-4 w-4" />
          儲存
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4" />
            客戶與裝置
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>客戶姓名 *</Label>
            <Input value={form.customer_name} onChange={(e) => setForm(p => ({ ...p, customer_name: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>聯絡電話</Label>
            <Input value={form.customer_phone} onChange={(e) => setForm(p => ({ ...p, customer_phone: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>型號</Label>
            <Select value={form.device_model_id} onValueChange={(v) => setForm(p => ({ ...p, device_model_id: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="選擇型號..." />
              </SelectTrigger>
              <SelectContent>
                {deviceModels.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.brand_name ? `${m.brand_name} ` : ''}{m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>顏色</Label>
            <Input value={form.device_color} onChange={(e) => setForm(p => ({ ...p, device_color: e.target.value }))} placeholder="太空黑" />
          </div>
          <div className="space-y-2">
            <Label>容量</Label>
            <Input value={form.device_storage} onChange={(e) => setForm(p => ({ ...p, device_storage: e.target.value }))} placeholder="256GB" />
          </div>
          <div className="space-y-2">
            <Label>IMEI</Label>
            <Input value={form.device_imei} onChange={(e) => setForm(p => ({ ...p, device_imei: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>密碼</Label>
            <Input value={form.device_passcode} onChange={(e) => setForm(p => ({ ...p, device_passcode: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>外觀狀況</Label>
            <Input value={form.device_condition} onChange={(e) => setForm(p => ({ ...p, device_condition: e.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>問題描述</Label>
            <Textarea value={form.reported_issue} onChange={(e) => setForm(p => ({ ...p, reported_issue: e.target.value }))} rows={3} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">維修項目</CardTitle>
          <Button variant="outline" size="sm" onClick={addItem}>
            <Plus className="h-4 w-4 mr-1" />
            新增
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 p-2 border rounded-lg">
              <Input
                value={item.service_name}
                onChange={(e) => setItems(prev => prev.map(i => i.id === item.id ? { ...i, service_name: e.target.value } : i))}
                placeholder="維修項目"
                className="flex-1"
              />
              <Input
                type="number"
                value={item.quantity || 1}
                onChange={(e) => setItems(prev => prev.map(i => i.id === item.id ? { ...i, quantity: parseInt(e.target.value) || 1 } : i))}
                className="w-16 text-center"
                min={1}
              />
              <Input
                type="number"
                value={item.unit_price}
                onChange={(e) => setItems(prev => prev.map(i => i.id === item.id ? { ...i, unit_price: parseFloat(e.target.value) || 0 } : i))}
                placeholder="價格"
                className="w-24 text-right"
              />
              <Button variant="ghost" size="icon" className="text-destructive shrink-0" onClick={() => removeItem(item.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">尚未新增項目，請點擊「新增」</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">費用</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-lg font-bold">
            <span>合計</span>
            <span className="font-mono">${totalPrice.toLocaleString()}</span>
          </div>
          <div className="space-y-2">
            <Label>已收定金</Label>
            <Input
              type="number"
              value={form.deposit}
              onChange={(e) => setForm(p => ({ ...p, deposit: parseFloat(e.target.value) || 0 }))}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
