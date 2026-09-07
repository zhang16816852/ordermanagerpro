import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
import { REPAIR_ORDER_STATUS_LABELS, RepairOrderInsert } from '@/types/repair';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/formatters';
import { getErrorMessage } from '@/lib/errorMessages';
import { useRepairBase } from '@/lib/repairBase';
import { ModelPickerOption } from '@/components/repair/ModelPicker';
import {
  DeviceBlock,
  createEmptyDeviceBlock,
  calcBlockTotals,
  DeviceBlockSection,
  DeviceBlockSummaryCard,
} from '@/components/repair/DeviceBlockSection';
import { ProductFormDialog } from '@/components/products/form/ProductFormDialog';
import { useProductMutations } from '@/pages/admin/products/hooks/useProductMutations';
import { StorePicker } from '@/components/ui/StorePicker';
import { RepairPurchaseDialog } from '@/components/repair/RepairPurchaseDialog';

interface DeviceModelOption extends ModelPickerOption {
  specifications: any;
}

export default function AdminRepairOrderForm() {
  const navigate = useNavigate();
  const repairBase = useRepairBase();
  const { id } = useParams();
  const { user, storeId } = useAuth();
  const isEdit = !!id;
  const queryClient = useQueryClient();

  const { updateMutation } = useRepairOrders(storeId || undefined);
  const { technicians = [] } = useRepairTechnicians();
  const { createMutation: createProductMutation } = useProductMutations(async () => {
    queryClient.invalidateQueries({ queryKey: ['repair_parts'] });
  });

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

  const { data: sourceStores = [] } = useQuery({
    queryKey: ['repair_source_stores'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('list_repair_source_stores');
      if (error) throw error;
      return (data || []) as { id: string; name: string; code: string; brand: string }[];
    },
  });

  const checklistSuggestions = useMemo(() => ({
    appearance: checklistLibrary.filter((c: any) => c.category === 'appearance').map((c: any) => c.item_name) as string[],
    functional: checklistLibrary.filter((c: any) => c.category === 'functional').map((c: any) => c.item_name) as string[],
  }), [checklistLibrary]);

  const [customer, setCustomer] = useState({
    customer_name: '',
    customer_phone: '',
    customer_email: '',
    customer_notes: '',
  });
  const [status, setStatus] = useState('pending');
  const [assignedTo, setAssignedTo] = useState<string>(user?.id || '');
  const [sourceStoreId, setSourceStoreId] = useState<string>(storeId || '');
  const [blocks, setBlocks] = useState<DeviceBlock[]>(() => [createEmptyDeviceBlock()]);
  const [existingItemIds, setExistingItemIds] = useState<string[]>([]);

  const [partDialogOpen, setPartDialogOpen] = useState(false);
  const [partModelId, setPartModelId] = useState<string | null>(null);

  const openCreatePart = (modelId: string | null) => {
    setPartModelId(modelId);
    setPartDialogOpen(true);
  };

  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [activePurchaseBlock, setActivePurchaseBlock] = useState<DeviceBlock | null>(null);

  const handleRequestPurchase = (block: DeviceBlock) => {
    setActivePurchaseBlock(block);
    setPurchaseDialogOpen(true);
  };

  const handleItemsLinked = (blockKey: string, links: { itemId: string; purchaseOrderItemId: string; unitCost?: number; isReceived?: boolean }[]) => {
    setBlocks(prev => prev.map(b => {
      if (b.key !== blockKey) return b;
      return {
        ...b,
        items: b.items.map(item => {
          const match = links.find(l => l.itemId === item.id);
          if (match) {
            return {
              ...item,
              purchase_order_item_id: match.purchaseOrderItemId,
              unit_cost: match.unitCost !== undefined && match.unitCost > 0 ? match.unitCost : item.unit_cost,
            };
          }
          return item;
        }),
      };
    }));
  };

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
          customer_email: orderData.customer_email || '',
          customer_notes: orderData.customer_notes || '',
        });
        setStatus(orderData.status);
        setAssignedTo(orderData.assigned_to || '');
        setSourceStoreId(orderData.store_id || '');

        const mappedItems = (itemsData || []).map((i: any) => {
          const isPart = i.item_type === 'part' || !!(i.product_id || i.variant_id);
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
          diagnostic_result: orderData.diagnostic_result || '',
          internal_notes: orderData.internal_notes || '',
          items: mappedItems,
          appearanceChecklist,
          functionalChecklist,
          discount: orderData.discount || 0,
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

  const saveItems = async (orderId: string, block: DeviceBlock, existingIds: string[]) => {
    const user = (await supabase.auth.getUser()).data.user;
    const db = supabase as any;
    const removedIds = existingIds.filter(dbId => !block.items.some(i => i.id === dbId));
    if (removedIds.length > 0) {
      const { error } = await db.from('repair_order_items').delete().in('id', removedIds);
      if (error) toast.error('刪除品項失敗：' + getErrorMessage(error));
    }

    const newRows: any[] = [];
    const updateRows: any[] = [];
    const itemsToDeduct: { itemId: string; productId: string | null; variantId: string | null; quantity: number; poItemId: string | null; name: string }[] = [];

    block.items.forEach((it, idx) => {
      const row = {
        item_type: it.item_type,
        service_name: it.item_type === 'service' ? it.service_name || null : null,
        part_name: it.item_type === 'part' ? it.part_name || null : null,
        product_id: it.item_type === 'part' ? it.product_id || null : null,
        variant_id: it.item_type === 'part' ? it.variant_id || null : null,
        quantity: it.quantity,
        unit_cost: it.unit_cost,
        unit_price: it.unit_price,
        description: it.description || null,
        sort_order: idx,
      };
      if (it.id && existingIds.includes(it.id)) {
        updateRows.push({ id: it.id, ...row, purchase_order_item_id: it.purchase_order_item_id || null });
        if (!it.is_stock_deducted && it.item_type === 'part' && (it.product_id || it.variant_id)) {
          itemsToDeduct.push({
            itemId: it.id,
            productId: it.product_id,
            variantId: it.variant_id,
            quantity: it.quantity,
            poItemId: it.purchase_order_item_id || null,
            name: it.part_name || '零件',
          });
        }
      } else {
        newRows.push({ repair_order_id: orderId, ...row, is_stock_deducted: false, purchase_order_item_id: it.purchase_order_item_id || null });
      }
    });

    if (updateRows.length > 0) {
      for (const row of updateRows) {
        const { error } = await db.from('repair_order_items').update(row).eq('id', row.id);
        if (error) toast.error('更新品項失敗：' + getErrorMessage(error));
      }
    }

    if (newRows.length > 0) {
      const { data: inserted, error } = await db.from('repair_order_items').insert(newRows).select('id, product_id, variant_id, quantity');
      if (error) {
        toast.error('品項儲存失敗：' + getErrorMessage(error));
        return;
      }
      const insertedList = inserted || [];
      for (let k = 0; k < insertedList.length; k++) {
        const row = insertedList[k];
        if (row.product_id || row.variant_id) {
          itemsToDeduct.push({
            itemId: row.id,
            productId: row.product_id,
            variantId: row.variant_id,
            quantity: row.quantity,
            poItemId: newRows[k]?.purchase_order_item_id || null,
            name: newRows[k]?.part_name || '零件',
          });
        }
      }
    }

    // 統一對所有需要扣庫存的零件項目呼叫 deduct_repair_part_stock
    const deductErrors: string[] = [];
    if (itemsToDeduct.length > 0 && user) {
      for (const itm of itemsToDeduct) {
        try {
          const { data: rpcResult, error: rpcError } = await db.rpc('deduct_repair_part_stock', {
            p_repair_order_id: orderId,
            p_item_id: itm.itemId,
            p_product_id: itm.productId,
            p_variant_id: itm.variantId,
            p_quantity: itm.quantity,
            p_created_by: user.id,
            p_purchase_order_item_id: itm.poItemId || null,
          });
          if (rpcError) {
            deductErrors.push(`${itm.name}：${getErrorMessage(rpcError)}`);
          } else if (rpcResult && rpcResult.ok === false) {
            deductErrors.push(`${itm.name}：${rpcResult.error || '扣庫存失敗'}`);
          }
        } catch (err: any) {
          deductErrors.push(`${itm.name}：${getErrorMessage(err)}`);
        }
      }
    }

    if (deductErrors.length > 0) {
      toast.warning('部分零件庫存未完成扣減（可能庫存不足或未收貨）：' + deductErrors.join('；'));
    }
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
    customer_email: customer.customer_email || null,
    customer_notes: customer.customer_notes || null,
    device_model_id: block.device_model_id || null,
    device_color: block.device_color || null,
    device_storage: block.device_storage || null,
    device_ram: block.device_ram || null,
    device_specs: block.device_cpu ? { cpu: block.device_cpu } : {},
    device_imei: block.device_imei || null,
    device_sn: block.device_sn || null,
    device_lock_type: block.device_lock_type,
    device_passcode: block.device_passcode || null,
    device_passcode_pattern: block.device_passcode_pattern || null,
    device_condition: block.device_condition || null,
    reported_issue: block.reported_issue || null,
    diagnostic_result: block.diagnostic_result || null,
    internal_notes: block.internal_notes || null,
    status,
    assigned_to: assignedTo || null,
    parts_cost: totals.partsCost,
    labor_fee: totals.laborFee,
    total_cost: totals.partsCost,
    total_price: totals.totalPrice,
    discount: block.discount,
    deposit: block.deposit,
    store_id: sourceStoreId || null,
    created_by: user?.id,
  });

  const insertOrder = async (payload: any) => {
    const { data, error } = await (supabase.from('repair_orders' as any) as any).insert([payload]).select().single();
    if (error) throw error;
    return data;
  };

  const handleSubmit = async () => {
    const user = (await supabase.auth.getUser()).data.user;

    if (isEdit && id) {
      const block = blocks[0];
      const totals = calcBlockTotals(block);
      const payload = buildPayload(block, totals);
      updateMutation.mutate(
        { id, values: payload as RepairOrderInsert },
        {
          onSuccess: async () => {
            try {
              await saveItems(id, block, existingItemIds);
              await saveChecklists(id, block);
              await queryClient.invalidateQueries({ queryKey: ['repair_order', id] });
              await queryClient.invalidateQueries({ queryKey: ['repair_orders'] });
              navigate(`${repairBase}/${id}`);
            } catch (err) {
              console.error('儲存維修單項目失敗：', err);
            }
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
        await saveItems(order.id, block, []);
        await saveChecklists(order.id, block);
        createdIds.push(order.id);
      } catch (e: any) {
        toast.error(`第 ${createdIds.length + 1} 個裝置區塊建立失敗：${getErrorMessage(e)}`);
        break;
      }
    }

    queryClient.invalidateQueries({ queryKey: ['repair_orders'] });
    if (createdIds.length > 0) {
      toast.success(`已建立 ${createdIds.length} 張維修單`);
      navigate(`${repairBase}`);
    }
  };

  const aggregate = blocks.reduce((acc, b) => {
    const t = calcBlockTotals(b);
    return { total: acc.total + t.totalPrice, partsCost: acc.partsCost + t.partsCost };
  }, { total: 0, partsCost: 0 });

  const customerCard = (
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
          <Input value={customer.customer_name} onChange={(e) => setCustomer(p => ({ ...p, customer_name: e.target.value }))} placeholder="姓名" />
        </div>
        <div className="space-y-2">
          <Label>聯絡電話</Label>
          <Input value={customer.customer_phone} onChange={(e) => setCustomer(p => ({ ...p, customer_phone: e.target.value }))} placeholder="0912-345-678" />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input value={customer.customer_email} onChange={(e) => setCustomer(p => ({ ...p, customer_email: e.target.value }))} placeholder="email@example.com" />
        </div>
        <div className="space-y-2">
          <Label>備註</Label>
          <Input value={customer.customer_notes} onChange={(e) => setCustomer(p => ({ ...p, customer_notes: e.target.value }))} placeholder="客戶特殊需求" />
        </div>
      </CardContent>
    </Card>
  );

  const statusCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="h-4 w-4" />
          狀態與指派
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>來源店家</Label>
          <StorePicker
            stores={sourceStores}
            value={sourceStoreId}
            onChange={(val) => setSourceStoreId(val as string)}
            placeholder="選擇來源店家（可搜尋名稱、編號）..."
            searchPlaceholder="搜尋店家名稱、代碼..."
            notFoundText="找不到符合的店家"
          />
          <p className="text-xs text-muted-foreground">選擇後該店家成員即可在自己的維修單列表看到此案；留空＝不指定店家。</p>
        </div>
        <div className="space-y-2">
          <Label>狀態</Label>
          <Select value={status} onValueChange={setStatus}>
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
          <Label>接案人</Label>
          <Select value={assignedTo} onValueChange={setAssignedTo}>
            <SelectTrigger>
              <SelectValue placeholder="選擇接案人..." />
            </SelectTrigger>
            <SelectContent>
              {technicians.map((t: any) => (
                <SelectItem key={t.id} value={t.id}>{t.full_name || t.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">狀態與接案人會套用至全部裝置區塊。</p>
        </div>
        <div className="space-y-2">
          <Label className="text-sm">區塊總覽</Label>
          <div className="space-y-2">
            {blocks.map((b, i) => (
              <DeviceBlockSummaryCard key={b.key} block={b} models={deviceModels} index={i} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`${repairBase}`)} aria-label="返回維修單列表">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {isEdit ? '編輯維修單' : blocks.length > 1 ? `新增維修單（${blocks.length} 個裝置）` : '新增維修單'}
          </h1>
        </div>
        <Button onClick={handleSubmit} className="hidden lg:inline-flex">
          <Save className="mr-2 h-4 w-4" />
          {isEdit ? '儲存' : `儲存（建立 ${blocks.length} 張）`}
        </Button>
      </div>

      <div className="hidden lg:grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {customerCard}
          {blocks.map((b, i) => (
            <DeviceBlockSection
              key={b.key}
              block={b}
              index={i}
              total={blocks.length}
              models={deviceModels}
              mode="admin"
              suggestions={checklistSuggestions}
              onUpdate={updateBlock}
              onAddBlock={addBlock}
              onRemoveBlock={removeBlock}
              onCreatePart={openCreatePart}
              onRequestPurchase={handleRequestPurchase}
            />
          ))}
        </div>
        <div className="space-y-6">
          {statusCard}
          {isEdit && (
            <Button variant="outline" className="w-full" onClick={() => navigate(`${repairBase}/${id}`)}>
              檢視詳細
            </Button>
          )}
        </div>
      </div>

      <div className="lg:hidden space-y-3">
        {customerCard}
        {blocks.map((b, i) => (
          <DeviceBlockSection
            key={b.key}
            block={b}
            index={i}
            total={blocks.length}
            models={deviceModels}
            mode="admin"
            suggestions={checklistSuggestions}
            onUpdate={updateBlock}
            onAddBlock={addBlock}
            onRemoveBlock={removeBlock}
            onCreatePart={openCreatePart}
            onRequestPurchase={handleRequestPurchase}
          />
        ))}

        <div className="sticky bottom-0 z-20 -mx-1 px-1 py-2 bg-background/95 backdrop-blur border-t">
          <div className="flex items-center gap-3">
            <div className="flex-1 text-sm">
              {!isEdit && (
                <>
                  <span className="text-muted-foreground">{blocks.length} 個裝置 </span>
                </>
              )}
              <span className="text-muted-foreground">應收 </span>
              <span className="font-mono font-semibold">{formatCurrency(aggregate.total)}</span>
            </div>
            <Button onClick={handleSubmit} className="flex-1">
              <Save className="mr-2 h-4 w-4" />
              {isEdit ? '儲存' : `建立 ${blocks.length} 張維修單`}
            </Button>
          </div>
        </div>
      </div>

      <ProductFormDialog
        open={partDialogOpen}
        onOpenChange={setPartDialogOpen}
        onSubmit={createProductMutation.mutate}
        initialData={{
          name: '新維修零件',
          code: '',
          item_type: 'repair_part',
          is_hidden: false,
          unified_pricing: false,
          unified_wholesale_price: 0,
          unified_retail_price: 0,
          category_ids: [],
          brand_ids: [],
          brand_series_ids: [],
          device_model_group_ids: [],
          device_model_exclusion_ids: [],
          device_model_ids: partModelId ? [partModelId] : [],
        } as any}
      />

      <RepairPurchaseDialog
        open={purchaseDialogOpen}
        onOpenChange={setPurchaseDialogOpen}
        block={activePurchaseBlock}
        deviceModelName={deviceModels.find(m => m.id === activePurchaseBlock?.device_model_id)?.name}
        customerName={customer.customer_name}
        onItemsLinked={handleItemsLinked}
      />
    </div>
  );
}