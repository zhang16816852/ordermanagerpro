import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save, User, Smartphone } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRepairOrders, useRepairTechnicians } from '@/hooks/useRepairOrders';
import { useAuth } from '@/hooks/useAuth';
import { RepairOrderInsert } from '@/types/repair';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/formatters';
import { getErrorMessage } from '@/lib/errorMessages';
import { ModelPickerOption } from '@/components/repair/ModelPicker';
import {
  DeviceBlock,
  createEmptyDeviceBlock,
  calcBlockTotals,
  DeviceBlockSection,
} from '@/components/repair/DeviceBlockSection';

interface DeviceModelOption extends ModelPickerOption {
  specifications: any;
}

export default function StoreRepairOrderForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { storeId } = useAuth();
  const isEdit = !!id;
  const { createMutation, updateMutation } = useRepairOrders(storeId || undefined);
  const { technicians } = useRepairTechnicians();

  const { data: deviceModels = [] } = useQuery<DeviceModelOption[]>({
    queryKey: ['device_models_list'],
    queryFn: async () => {
      const { data } = await (supabase
        .from('device_models') as any)
        .select('*, device_brand:brand_id(name)')
        .order('name');
      return (data || []).map((m: any) => ({
        id: m.id,
        name: m.name,
        device_type: m.device_type,
        specifications: m.specifications,
        brand_name: m.device_brand?.name || null,
        aliases: Array.isArray(m.aliases) ? m.aliases.filter((a: string) => a) : null,
      })) as DeviceModelOption[];
    },
  });

  const { data: checklistLibrary = [] } = useQuery({
    queryKey: ['repair_checklist_library'],
    queryFn: async () => {
      const { data } = await (supabase.from('repair_checklist_library' as any) as any)
        .select('*')
        .order('sort_order');
      return data || [];
    },
  });

  const checklistSuggestions = useMemo(() => ({
    appearance: checklistLibrary.filter((c: any) => c.category === 'appearance').map((c: any) => c.item_name) as string[],
    functional: checklistLibrary.filter((c: any) => c.category === 'functional').map((c: any) => c.item_name) as string[],
  }), [checklistLibrary]);

  const [customer, setCustomer] = useState({
    customer_name: '',
    customer_phone: '',
  });
  const [status, setStatus] = useState('pending');
  const [assignedTo, setAssignedTo] = useState('__open__');
  const [blocks, setBlocks] = useState<DeviceBlock[]>(() => [createEmptyDeviceBlock()]);
  const [existingItemIds, setExistingItemIds] = useState<string[]>([]);

  useEffect(() => {
    if (isEdit && id) {
      Promise.all([
        (supabase.from('repair_orders' as any) as any).select('*').eq('id', id).single(),
        (supabase.from('repair_order_items' as any) as any).select('*').eq('repair_order_id', id).order('sort_order'),
        (supabase.from('repair_device_checklists' as any) as any).select('*').eq('repair_order_id', id).order('sort_order'),
      ]).then(([{ data: orderData, error: orderError }, { data: itemsData }, { data: checklistsData }]) => {
        if (orderError || !orderData) return;

        setCustomer({
          customer_name: orderData.customer_name || '',
          customer_phone: orderData.customer_phone || '',
        });
        setStatus(orderData.status);
        setAssignedTo(orderData.assigned_to || '__open__');

        const mappedItems = (itemsData || []).map((i: any) => {
          const isPart = i.item_type === 'part' || !!i.product_id;
          return {
            id: i.id,
            item_type: (isPart ? 'part' : 'service') as 'part' | 'service',
            service_name: i.service_name || i.part_name || '',
            part_name: i.part_name || i.service_name || '',
            product_id: i.product_id || null,
            variant_id: i.variant_id || null,
            quantity: i.quantity || 1,
            unit_cost: i.unit_cost || 0,
            unit_price: i.unit_price || 0,
            description: i.description || '',
            is_stock_deducted: !!i.is_stock_deducted,
            purchase_order_item_id: i.purchase_order_item_id || null,
          };
        });

        setExistingItemIds(mappedItems.map((i: any) => i.id));

        const appearanceChecklist = (checklistsData || [])
          .filter((c: any) => c.category === 'appearance')
          .map((c: any) => ({
            id: c.id, item_name: c.item_name, is_checked: c.is_checked, note: c.note || '',
          }));

        const functionalChecklist = (checklistsData || [])
          .filter((c: any) => c.category === 'functional')
          .map((c: any) => ({
            id: c.id, item_name: c.item_name, is_checked: c.is_checked, note: c.note || '',
          }));

        setBlocks([{
          key: crypto.randomUUID(),
          device_model_id: orderData.device_model_id || '',
          device_color: orderData.device_color || '',
          device_storage: orderData.device_storage || '',
          device_ram: orderData.device_ram || '',
          device_cpu: orderData.device_specs?.cpu || '',
          device_imei: orderData.device_imei || '',
          device_sn: orderData.device_sn || '',
          device_lock_type: orderData.device_lock_type || 'none',
          device_passcode: orderData.device_passcode || '',
          device_passcode_pattern: orderData.device_passcode_pattern || '',
          device_condition: orderData.device_condition || '',
          reported_issue: orderData.reported_issue || '',
          diagnostic_result: '',
          internal_notes: '',
          items: mappedItems,
          appearanceChecklist,
          functionalChecklist,
          discount: 0,
          deposit: orderData.deposit || 0,
        }]);
      });
    }
  }, [id, isEdit]);

  const updateBlock = (block: DeviceBlock) => {
    setBlocks(prev => prev.map(b => (b.key === block.key ? block : b)));
  };

  const addBlock = () => {
    setBlocks(prev => [...prev, createEmptyDeviceBlock()]);
  };

  const removeBlock = (key: string) => {
    setBlocks(prev => prev.filter(b => b.key !== key));
  };

  const saveChecklists = async (orderId: string, block: DeviceBlock) => {
    const db = supabase as any;
    await db.from('repair_device_checklists').delete().eq('repair_order_id', orderId);
    const all: { category: string; item_name: string; is_checked: boolean; note: string | null }[] = [
      ...block.appearanceChecklist.map(c => ({ category: 'appearance', item_name: c.item_name, is_checked: c.is_checked, note: c.note || null })),
      ...block.functionalChecklist.map(c => ({ category: 'functional', item_name: c.item_name, is_checked: c.is_checked, note: c.note || null })),
    ];
    if (all.length > 0) {
      const { error } = await db.from('repair_device_checklists').insert(
        all.map((c, i) => ({ repair_order_id: orderId, ...c, sort_order: i }))
      );
      if (error) toast.error('檢查清單儲存失敗：' + getErrorMessage(error));
    }
    for (const c of all) {
      await db.rpc('upsert_repair_checklist_library', { p_category: c.category, p_item_name: c.item_name });
    }
  };

  const buildPayload = (block: DeviceBlock, totals: ReturnType<typeof calcBlockTotals>) => ({
    customer_name: customer.customer_name || null,
    customer_phone: customer.customer_phone || null,
    device_model_id: block.device_model_id || null,
    device_color: block.device_color || null,
    device_storage: block.device_storage || null,
    device_specs: block.device_cpu ? { cpu: block.device_cpu } : {},
    device_imei: block.device_imei || null,
    device_lock_type: block.device_lock_type,
    device_passcode: block.device_passcode || null,
    device_passcode_pattern: block.device_passcode_pattern || null,
    device_condition: block.device_condition || null,
    reported_issue: block.reported_issue || null,
    total_price: totals.totalPrice,
    deposit: block.deposit,
    status,
    assigned_to: assignedTo && assignedTo !== '__open__' ? assignedTo : null,
    store_id: storeId || null,
  });

  const insertOrder = async (payload: any) => {
    const { data, error } = await (supabase.from('repair_orders' as any) as any).insert([payload]).select().single();
    if (error) throw error;
    return data;
  };

  const handleSubmit = async () => {
    if (isEdit && id) {
      const block = blocks[0];
      const totals = calcBlockTotals(block);
      const payload = buildPayload(block, totals);
      updateMutation.mutate(
        { id, values: payload as RepairOrderInsert },
        {
          onSuccess: async () => {
            await saveChecklists(id, block);
            navigate(`/dashboard/repair-orders/${id}`);
          },
        }
      );
      return;
    }

    const createdIds: string[] = [];
    for (const block of blocks) {
      const totals = calcBlockTotals(block);
      const payload = buildPayload(block, totals);
      try {
        const order = await insertOrder(payload);
        await saveChecklists(order.id, block);
        createdIds.push(order.id);
      } catch (e: any) {
        toast.error(`第 ${createdIds.length + 1} 個裝置區塊建立失敗：${getErrorMessage(e)}`);
        break;
      }
    }

    if (createdIds.length > 0) {
      toast.success(`已建立 ${createdIds.length} 張維修單`);
      navigate('/dashboard/repair-orders');
    }
  };

  const aggregateTotal = blocks.reduce((acc, b) => acc + calcBlockTotals(b).totalPrice, 0);

  return (
    <div className="space-y-6 max-w-3xl mx-auto pb-24">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard/repair-orders')} aria-label="返回維修單列表">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {isEdit ? '編輯維修單' : blocks.length > 1 ? `新增維修單（${blocks.length} 個裝置）` : '新增維修單'}
          </h1>
        </div>
        <Button onClick={handleSubmit} className="hidden sm:inline-flex">
          <Save className="mr-2 h-4 w-4" />
          {isEdit ? '儲存' : `儲存（建立 ${blocks.length} 張）`}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            客戶資訊（共用於所有裝置區塊）
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>客戶姓名 <span className="text-muted-foreground text-xs">（可留空）</span></Label>
            <Input value={customer.customer_name} onChange={(e) => setCustomer(p => ({ ...p, customer_name: e.target.value }))} placeholder="姓名（門市現場維修可留空）" />
          </div>
          <div className="space-y-2">
            <Label>聯絡電話</Label>
            <Input value={customer.customer_phone} onChange={(e) => setCustomer(p => ({ ...p, customer_phone: e.target.value }))} placeholder="0912-345-678" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4" />
            發布與指派
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>接案人</Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger>
                <SelectValue placeholder="選擇接案人..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__open__">開放待接案（不指定）</SelectItem>
                {(technicians || []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.full_name || t.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              指派給接案人後，該接案人可在維修工作檯看到此單；不指定則開放待接案。設定會套用至全部裝置區塊。
            </p>
          </div>
        </CardContent>
      </Card>

      {blocks.map((b, i) => (
        <DeviceBlockSection
          key={b.key}
          block={b}
          index={i}
          total={blocks.length}
          models={deviceModels}
          mode="store"
          suggestions={checklistSuggestions}
          onUpdate={updateBlock}
          onAddBlock={addBlock}
          onRemoveBlock={removeBlock}
        />
      ))}

      <div className="fixed bottom-0 left-0 right-0 z-20 bg-background/95 backdrop-blur border-t p-3 sm:hidden">
        <Button onClick={handleSubmit} className="w-full">
          <Save className="mr-2 h-4 w-4" />
          {isEdit ? '儲存維修單' : `建立 ${blocks.length} 張維修單（${formatCurrency(aggregateTotal)}）`}
        </Button>
      </div>
    </div>
  );
}