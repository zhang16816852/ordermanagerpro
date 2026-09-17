import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Edit, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { useRepairOrderDetail, useRepairOrders, useRepairAssigneeMap } from '@/hooks/useRepairOrders';
import { REPAIR_ORDER_STATUS_LABELS, REPAIR_ORDER_STATUS_COLORS, REPAIR_ORDER_STATUS_STEPS, isRepairOrderAcceptable } from '@/types/repair';
import { useAuth } from '@/hooks/useAuth';
import { formatDate } from '@/lib/formatters';
import { useReactToPrint } from 'react-to-print';
import { useRepairBase } from '@/lib/repairBase';
import { EntryDialog } from '@/pages/admin/accounting/components/EntryDialog';
import { useAccounting } from '@/pages/admin/accounting/hooks/useAccounting';
import { EntryPrefill } from '@/pages/admin/accounting/components/EntryForm';
import { RepairReceipt } from './RepairReceipt';
import { RepairInfoCards } from './RepairInfoCards';
import { RepairItemsSection } from './RepairItemsSection';
import { RepairSidebar } from './RepairSidebar';

const STATUS_STEPS = REPAIR_ORDER_STATUS_STEPS;

export default function AdminRepairOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const repairBase = useRepairBase();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { order, isLoading } = useRepairOrderDetail(id || '');
  const { acceptAndStartMutation, deleteMutation } = useRepairOrders();
  const assignees = useRepairAssigneeMap();
  const { accounts, categories, createEntryMutation, isLoadingAccounts, isLoadingCategories } = useAccounting();
  const printRef = useRef<HTMLDivElement>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [isDeductingAll, setIsDeductingAll] = useState(false);
  const [collectEntryOpen, setCollectEntryOpen] = useState(false);
  const [collectPrefill, setCollectPrefill] = useState<EntryPrefill | null>(null);

  const deductSinglePartMutation = useMutation({
    mutationFn: async (item: any) => {
      const u = (await supabase.auth.getUser()).data.user;
      if (!u) throw new Error('尚未登入');
      const { data, error } = await (supabase as any).rpc('deduct_repair_part_stock', {
        p_repair_order_id: order?.id,
        p_item_id: item.id,
        p_product_id: item.product_id,
        p_variant_id: item.variant_id,
        p_quantity: item.quantity || 1,
        p_created_by: u.id,
        p_purchase_order_item_id: item.purchase_order_item_id || null,
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error || '扣庫存失敗');
      return data;
    },
    onSuccess: () => {
      toast.success('零件已成功出庫扣減庫存！');
      queryClient.invalidateQueries({ queryKey: ['repair_order', id] });
      queryClient.invalidateQueries({ queryKey: ['repair_orders'] });
      queryClient.invalidateQueries({ queryKey: ['repair_parts_catalog'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-list'] });
    },
    onError: (err: any) => {
      toast.error('扣庫存失敗：' + getErrorMessage(err));
    },
  });

  const handleDeductAll = async () => {
    if (!order) return;
    const undeducted = (order.items || []).filter((i: any) => {
      const isPart = i.item_type === 'part' || (!i.item_type && !!(i.product_id || i.variant_id));
      return isPart && !i.is_stock_deducted && (i.product_id || i.variant_id);
    });
    if (undeducted.length === 0) return;

    try {
      setIsDeductingAll(true);
      const u = (await supabase.auth.getUser()).data.user;
      if (!u) throw new Error('尚未登入');
      const errors: string[] = [];
      for (const itm of undeducted) {
        const { data, error } = await (supabase as any).rpc('deduct_repair_part_stock', {
          p_repair_order_id: order.id,
          p_item_id: itm.id,
          p_product_id: itm.product_id,
          p_variant_id: itm.variant_id,
          p_quantity: itm.quantity || 1,
          p_created_by: u.id,
          p_purchase_order_item_id: itm.purchase_order_item_id || null,
        });
        const name = itm.part_name || itm.variant?.name || itm.product?.name || '零件';
        if (error) errors.push(`${name}：${getErrorMessage(error)}`);
        else if (data && data.ok === false) errors.push(`${name}：${data.error || '扣庫存失敗'}`);
      }

      queryClient.invalidateQueries({ queryKey: ['repair_order', id] });
      queryClient.invalidateQueries({ queryKey: ['repair_orders'] });
      queryClient.invalidateQueries({ queryKey: ['repair_parts_catalog'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-list'] });

      if (errors.length === 0) {
        toast.success('所有未扣零件已成功出庫扣減庫存！');
      } else {
        toast.warning('部分零件扣庫存未完成：' + errors.join('；'));
      }
    } catch (err: any) {
      toast.error('批量扣庫存失敗：' + getErrorMessage(err));
    } finally {
      setIsDeductingAll(false);
    }
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    pageStyle: '@page { size: 80mm auto; margin: 0; } @media print { body { -webkit-print-color-adjust: exact; } }',
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">載入中...</div>;
  if (!order) return <div className="p-8 text-center text-muted-foreground">維修單不存在</div>;

  const currentStepIndex = STATUS_STEPS.indexOf(order.status);
  const items = [...(order.items || [])].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const calculatedPartsCost = items
    .filter((i: any) => i.item_type === 'part' || (!i.item_type && !!(i.product_id || i.variant_id)))
    .reduce((s: number, i: any) => s + ((i.unit_cost || 0) * (i.quantity || 1)), 0);
  const totalPartsCost = calculatedPartsCost || order.parts_cost || 0;
  const calculatedTotalPrice = items.reduce((s: number, i: any) => s + ((i.unit_price || 0) * (i.quantity || 1)), 0);
  const totalPrice = calculatedTotalPrice || order.total_price || 0;
  const finalPrice = totalPrice - (order.discount || 0);
  const profit = finalPrice - totalPartsCost;
  const profitPercent = finalPrice > 0 ? ((profit / finalPrice) * 100).toFixed(1) : '0';
  const hasUndeductedParts = items.some((i: any) => {
    const isP = i.item_type === 'part' || (!i.item_type && !!(i.product_id || i.variant_id));
    return isP && !i.is_stock_deducted && (i.product_id || i.variant_id);
  });
  const isDeductingAnyPart = deductSinglePartMutation.isPending;
  const deductingItemId = deductSinglePartMutation.isPending ? ((deductSinglePartMutation.variables as any)?.id ?? null) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`${repairBase}`)} aria-label="返回維修單列表">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight font-mono">{order.code}</h1>
              <Badge className={REPAIR_ORDER_STATUS_COLORS[order.status as keyof typeof REPAIR_ORDER_STATUS_COLORS]}>
                {REPAIR_ORDER_STATUS_LABELS[order.status as keyof typeof REPAIR_ORDER_STATUS_LABELS]}
              </Badge>
              {order.payment_status === 'paid' ? (
                <Badge variant="secondary" className="text-[11px] font-normal bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300">
                  已收款
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[11px] font-normal text-amber-600 border-amber-300 dark:text-amber-400">
                  未收款
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              單據日期 {formatDate(order.order_date)}，建立於 {formatDate(order.created_at)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {isRepairOrderAcceptable(order.status) && user && (
            <Button onClick={() => acceptAndStartMutation.mutate({ id: order.id, userId: user.id })}>
              接單
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowReceipt(!showReceipt)}>
            <Printer className="mr-2 h-4 w-4" />
            {showReceipt ? '檢視詳細' : '收據預覽'}
          </Button>
          <Button variant="outline" onClick={() => navigate(`${repairBase}/${id}/edit`)}>
            <Edit className="mr-2 h-4 w-4" />
            編輯
          </Button>
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (!confirm('確定要刪除此維修單嗎？此操作無法復原。')) return;
              deleteMutation.mutate(order.id, {
                onSuccess: () => navigate(`${repairBase}`),
              });
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            刪除
          </Button>
        </div>
      </div>

      {showReceipt ? (
        <div className="flex flex-col items-center gap-4">
          <RepairReceipt order={order} items={items} finalPrice={finalPrice} printRef={printRef} />
          <Button onClick={() => handlePrint()}>
            <Printer className="mr-2 h-4 w-4" />
            列印收據
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 p-4 bg-muted/20 rounded-xl">
            {STATUS_STEPS.map((step, idx) => {
              const isCompleted = currentStepIndex >= idx;
              const isCurrent = currentStepIndex === idx;
              return (
                <div key={step} className="flex items-center flex-1">
                  <div className={`flex items-center gap-2 ${isCompleted ? 'text-primary' : 'text-muted-foreground'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      isCurrent ? 'bg-primary text-primary-foreground ring-2 ring-primary/30' :
                      isCompleted ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
                      {idx + 1}
                    </div>
                    <span className={`text-xs hidden md:inline ${isCurrent ? 'font-bold' : ''}`}>
                      {REPAIR_ORDER_STATUS_LABELS[step]}
                    </span>
                  </div>
                  {idx < STATUS_STEPS.length - 1 && (
                    <div className={`flex-1 h-px mx-2 ${isCompleted ? 'bg-primary/50' : 'bg-muted'}`} />
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <RepairInfoCards order={order} />

              <RepairItemsSection
                items={items}
                hasUndeductedParts={hasUndeductedParts}
                isDeductingAll={isDeductingAll}
                deductPending={isDeductingAnyPart}
                deductingItemId={deductingItemId}
                onDeductAll={handleDeductAll}
                onDeductSingle={(item) => deductSinglePartMutation.mutate(item)}
                onEdit={() => navigate(`${repairBase}/${id}/edit`)}
              />
            </div>

            <RepairSidebar
              order={order}
              assignees={assignees}
              totalPartsCost={totalPartsCost}
              finalPrice={finalPrice}
              profit={profit}
              profitPercent={profitPercent}
              onCollectPayment={() => {
                setCollectPrefill({
                  repair: {
                    subType: 'income_repair',
                    repairOrderId: order.id,
                    amount: finalPrice - order.deposit,
                    description: `維修收款 ${order.code || ''}`,
                  },
                });
                setCollectEntryOpen(true);
              }}
              onEdit={() => navigate(`${repairBase}/${id}/edit`)}
              onShowReceipt={() => setShowReceipt(true)}
            />
          </div>
        </>
      )}

      <EntryDialog
        open={collectEntryOpen}
        onOpenChange={setCollectEntryOpen}
        prefill={collectPrefill}
        categories={categories}
        accounts={accounts}
        isLoading={isLoadingAccounts || isLoadingCategories || createEntryMutation.isPending}
        onSubmit={(data, references) => {
          createEntryMutation.mutate(
            { data, references },
            { onSuccess: () => setCollectEntryOpen(false) }
          );
        }}
      />
    </div>
  );
}