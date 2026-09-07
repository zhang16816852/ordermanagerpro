import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Truck, Package, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/formatters';
import { getErrorMessage } from '@/lib/errorMessages';
import { DeviceBlock, RepairBlockItem } from '@/components/repair/DeviceBlockSection';
import { EntryDialog } from '@/pages/admin/accounting/components/EntryDialog';
import { EntryPrefill } from '@/pages/admin/accounting/components/EntryForm';
import { useAccounting } from '@/pages/admin/accounting/hooks/useAccounting';

export interface RepairPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  block: DeviceBlock | null;
  deviceModelName?: string;
  customerName?: string;
  onItemsLinked: (blockKey: string, links: { itemId: string; purchaseOrderItemId: string; unitCost: number; isReceived?: boolean }[]) => void;
}

interface PurchaseItemState {
  itemId: string;
  selected: boolean;
  partName: string;
  productId: string | null;
  variantId: string | null;
  quantity: number;
  unitCost: number;
  alreadyOrdered: boolean;
}

export function RepairPurchaseDialog({
  open,
  onOpenChange,
  block,
  deviceModelName,
  customerName,
  onItemsLinked,
}: RepairPurchaseDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState<string>('');
  const [expectedDate, setExpectedDate] = useState<string>('');
  const [supplierOrderNumber, setSupplierOrderNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [directReceive, setDirectReceive] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { accounts, categories, createEntryMutation } = useAccounting();
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [entryPrefill, setEntryPrefill] = useState<EntryPrefill | null>(null);

  const [purchaseItems, setPurchaseItems] = useState<PurchaseItemState[]>([]);

  // 抓取活躍供應商（排除不存在的 code 欄位以避免 PostgREST 報錯，並兼顧 is_active 為 null 的情況）
  const { data: suppliers = [], isLoading: isLoadingSuppliers } = useQuery({
    queryKey: ['active_suppliers'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('id, name')
        .or('is_active.eq.true,is_active.is.null')
        .order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
    enabled: open,
  });

  // 當打開或 block 改變時初始化品項列表
  useEffect(() => {
    if (open && block) {
      const partItems = block.items.filter(i => i.item_type === 'part' || (!i.item_type && !!(i.product_id || i.variant_id)));
      
      setPurchaseItems(
        partItems.map(item => {
          const alreadyOrdered = !!item.purchase_order_item_id;
          return {
            itemId: item.id,
            // 若尚未叫料則預設選取，若已叫料則預設不選取，方便分不同廠商叫料
            selected: !alreadyOrdered,
            partName: item.part_name || item.service_name || '零件項目',
            productId: item.product_id || null,
            variantId: item.variant_id || null,
            quantity: item.quantity || 1,
            unitCost: item.unit_cost || 0,
            alreadyOrdered,
          };
        })
      );

      // 預設備註
      const targetDevice = deviceModelName || '維修裝置';
      const targetCustomer = customerName ? `（客戶: ${customerName}）` : '';
      setNotes(`維修叫料 - ${targetDevice}${targetCustomer}`);
      setSupplierId('');
      setExpectedDate('');
      setSupplierOrderNumber('');
      setDirectReceive(false);
    }
  }, [open, block, deviceModelName, customerName]);

  const selectedCount = purchaseItems.filter(i => i.selected).length;
  const totalCost = purchaseItems
    .filter(i => i.selected)
    .reduce((sum, i) => sum + (i.unitCost * i.quantity), 0);

  const toggleSelectAll = (checked: boolean) => {
    setPurchaseItems(prev => prev.map(item => ({ ...item, selected: checked })));
  };

  const updateItem = (itemId: string, field: keyof PurchaseItemState, value: any) => {
    setPurchaseItems(prev => prev.map(item => item.itemId === itemId ? { ...item, [field]: value } : item));
  };

  const handleCreatePurchaseOrder = async () => {
    if (!supplierId) {
      toast.error('請選擇採購供應商');
      return;
    }

    const itemsToOrder = purchaseItems.filter(i => i.selected);
    if (itemsToOrder.length === 0) {
      toast.error('請至少勾選一項要向此供應商採購的零件');
      return;
    }

    try {
      setIsSubmitting(true);

      // 1. 建立採購單 (purchase_orders)
      const poDate = new Date().toISOString().split('T')[0];
      const { data: newPO, error: poError } = await (supabase as any)
        .from('purchase_orders')
        .insert({
          supplier_id: supplierId,
          status: directReceive ? 'received' : 'draft',
          order_date: poDate,
          received_date: directReceive ? poDate : null,
          expected_date: expectedDate || (directReceive ? poDate : null),
          supplier_order_number: supplierOrderNumber.trim() || null,
          total_amount: totalCost,
          notes: notes.trim()
            ? (directReceive ? `${notes.trim()} (維修建立直接收貨)` : notes.trim())
            : (directReceive ? '維修建立直接收貨' : null),
          created_by: user?.id,
        })
        .select('id, supplier_order_number')
        .single();

      if (poError) throw poError;

      // 2. 建立採購品項 (purchase_order_items)
      const linkedResults: { itemId: string; purchaseOrderItemId: string; unitCost: number; isReceived?: boolean }[] = [];
      const poItemsToInsert: any[] = [];

      for (let i = 0; i < itemsToOrder.length; i++) {
        const item = itemsToOrder[i];
        let pId = item.productId;
        const vId = item.variantId;
        if (!pId && vId) {
          try {
            const { data: vRow } = await (supabase.from('product_variants' as any) as any)
              .select('product_id')
              .eq('id', vId)
              .maybeSingle();
            if (vRow?.product_id) pId = vRow.product_id;
          } catch (e) {
            console.error('Failed to resolve product_id from variant_id', e);
          }
        }

        const { data: poItem, error: poItemError } = await (supabase as any)
          .from('purchase_order_items')
          .insert({
            purchase_order_id: newPO.id,
            product_id: pId,
            variant_id: vId,
            quantity: item.quantity,
            received_quantity: directReceive ? item.quantity : 0,
            unit_cost: item.unitCost,
            sort_order: i + 1,
          })
          .select('id')
          .single();

        if (poItemError) throw poItemError;

        linkedResults.push({
          itemId: item.itemId,
          purchaseOrderItemId: poItem.id,
          unitCost: item.unitCost,
          isReceived: directReceive,
        });

        poItemsToInsert.push({
          id: poItem.id,
          product_id: pId,
          variant_id: vId,
          quantity: item.quantity,
        });
      }

      const poCode = newPO.supplier_order_number || newPO.id.slice(0, 8);

      // 3. 若選擇直接收貨，呼叫 receive_purchase_items RPC 執行入庫流程與更新庫存
      if (directReceive) {
        const rpcPayload = poItemsToInsert.map((item) => ({
          id: item.id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          received_quantity: item.quantity,
          purchase_order_id: newPO.id,
          purchase_order_code: poCode,
          warehouse_id: null,
        }));

        const { error: rpcError } = await (supabase as any).rpc('receive_purchase_items', {
          p_items: rpcPayload,
          p_warehouse_id: null,
        });

        if (rpcError) {
          console.error('Auto receive failed:', rpcError);
          toast.error('採購單已建立，但自動收貨入庫失敗：' + getErrorMessage(rpcError));
        }
      }

      // 4. 失效快取以同步採購單與庫存
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
      queryClient.invalidateQueries({ queryKey: ['repair_parts_catalog'] });

      // 5. 回填至維修單中的品項
      if (block) {
        onItemsLinked(block.key, linkedResults);
      }

      const supplierName = suppliers.find(s => s.id === supplierId)?.name || '供應商';
      if (directReceive) {
        setEntryPrefill({
          amount: totalCost,
          description: `維修零件付款 - ${supplierName}（採購單 ${poCode}）`,
          referenceType: 'purchase_order',
          referenceId: newPO.id,
          transactionDate: poDate,
          markAsPaid: true,
          repair: {
            subType: 'expense_part',
            purchaseOrderId: newPO.id,
            supplierId: supplierId,
            amount: totalCost,
            description: `維修零件付款 - ${supplierName}（採購單 ${poCode}）`,
          },
        });
        toast.success(`已成功建立採購單（${poCode}）並完成收貨入庫！請確認付款帳戶以記錄支出金流`);
        onOpenChange(false);
        setEntryDialogOpen(true);
      } else {
        toast.success(`已成功建立採購單（${poCode}）！已向 ${supplierName} 叫料 ${itemsToOrder.length} 項零件`);
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error('建立採購單失敗：' + getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Truck className="h-5 w-5 text-primary" />
            維修零件叫料 / 建立採購單
          </DialogTitle>
          <DialogDescription>
            直接在當前維修單中呼叫採購單，表單不會切換中斷。若同裝置零件需向不同廠商叫貨，可分批勾選建立。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 供應商選擇 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                供應商 <span className="text-destructive">*</span>
              </Label>
              {suppliers.length > 0 && (
                <span className="text-xs text-muted-foreground">共 {suppliers.length} 家供應商</span>
              )}
            </div>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={isLoadingSuppliers ? '載入供應商中...' : '選擇此批零件叫貨的供應商...'} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {suppliers.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">
                    {isLoadingSuppliers ? '載入供應商中...' : '尚未建立任何有效供應商，請先至採購供應商管理新增'}
                  </div>
                ) : (
                  suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              同一個裝置的零件若屬於不同廠商，請先選擇此廠商並勾選對應零件建立，其餘零件可重複此流程向其他廠商叫料。
            </p>
          </div>

          {/* 直接收貨入庫開關（流程要走） */}
          <div className="flex items-start space-x-3 p-3 rounded-lg border border-primary/30 bg-primary/5 transition-colors">
            <Checkbox
              id="direct-receive"
              checked={directReceive}
              onCheckedChange={(checked) => setDirectReceive(!!checked)}
              className="mt-0.5"
            />
            <div className="space-y-0.5 select-none cursor-pointer flex-1" onClick={() => setDirectReceive(!directReceive)}>
              <Label htmlFor="direct-receive" className="text-sm font-medium cursor-pointer flex items-center gap-1.5 text-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                建立並直接完成收貨入庫（現成零件 / 現貨已到）
              </Label>
              <p className="text-xs text-muted-foreground">
                系統仍會正規建立採購單據並自動執行收貨入庫，增加庫存並記錄進貨成本批次，完整走完正式採購與入庫流程。
              </p>
            </div>
          </div>

          {/* 零件勾選列表 */}
          <div className="space-y-2 border rounded-lg p-3 bg-muted/20">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all-parts"
                  checked={purchaseItems.length > 0 && purchaseItems.every(i => i.selected)}
                  onCheckedChange={(checked) => toggleSelectAll(!!checked)}
                />
                <Label htmlFor="select-all-parts" className="text-xs font-semibold cursor-pointer">
                  零件品項列表（已勾選 {selectedCount} / {purchaseItems.length}）
                </Label>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                採購估計額: {formatCurrency(totalCost)}
              </span>
            </div>

            {purchaseItems.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm">
                <Package className="h-8 w-8 mx-auto mb-1.5 text-muted-foreground/40" />
                此裝置區塊尚未添加任何「零件材料」項目
              </div>
            ) : (
              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {purchaseItems.map((item) => (
                  <div
                    key={item.itemId}
                    className={`flex items-center gap-3 p-2 rounded-md border text-sm transition-colors ${
                      item.selected ? 'bg-background border-primary/40' : 'bg-muted/30 border-border opacity-80'
                    }`}
                  >
                    <Checkbox
                      checked={item.selected}
                      onCheckedChange={(checked) => updateItem(item.itemId, 'selected', !!checked)}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{item.partName}</span>
                        {item.alreadyOrdered ? (
                          <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 gap-0.5">
                            <CheckCircle2 className="h-3 w-3" /> 已叫料
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">待叫料</Badge>
                        )}
                      </div>
                      {!item.productId && !item.variantId && (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
                          自訂材料名稱（無特定商品料號）
                        </span>
                      )}
                    </div>

                    <div className="w-20">
                      <Label className="text-[11px] text-muted-foreground">數量</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(item.itemId, 'quantity', parseInt(e.target.value) || 1)}
                        className="h-7 text-xs text-center px-1"
                        disabled={!item.selected}
                      />
                    </div>

                    <div className="w-24">
                      <Label className="text-[11px] text-muted-foreground">預估成本</Label>
                      <Input
                        type="number"
                        min={0}
                        value={item.unitCost}
                        onChange={(e) => updateItem(item.itemId, 'unitCost', parseFloat(e.target.value) || 0)}
                        className="h-7 text-xs text-right px-2"
                        disabled={!item.selected}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 採購細節欄位 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">預計到貨日（選填）</Label>
              <Input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">廠商訂單編號（選填）</Label>
              <Input
                value={supplierOrderNumber}
                onChange={(e) => setSupplierOrderNumber(e.target.value)}
                placeholder="例如廠商對照單號"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">採購單備註</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="輸入此採購單備註..."
              className="text-sm resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            取消
          </Button>
          <Button
            onClick={handleCreatePurchaseOrder}
            disabled={isSubmitting || selectedCount === 0 || !supplierId}
            className="gap-1.5"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {directReceive
              ? `建立採購單並直接收貨（已選 ${selectedCount} 項）`
              : `建立採購單（已選 ${selectedCount} 項）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* 直接收貨後串接 EntryDialog 進行會計付款登記與帳戶餘額扣除 */}
    <EntryDialog
      open={entryDialogOpen}
      onOpenChange={setEntryDialogOpen}
      categories={categories}
      accounts={accounts}
      isLoading={createEntryMutation.isPending}
      prefill={entryPrefill}
      onSubmit={(data, references) => {
        createEntryMutation.mutate(
          { data, references },
          {
            onSuccess: () => {
              toast.success('零件採購款項已成功記入會計支出分錄並扣除帳戶餘額！');
              setEntryDialogOpen(false);
            },
          }
        );
      }}
    />
    </>
  );
}
