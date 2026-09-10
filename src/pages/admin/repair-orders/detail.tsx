import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Edit, Printer, Smartphone, User, DollarSign, Clock, History, ClipboardCheck, Package, Truck, PackageCheck, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { useRepairOrderDetail, useRepairOrders, useRepairAssigneeMap } from '@/hooks/useRepairOrders';
import { REPAIR_ORDER_STATUS_LABELS, REPAIR_ORDER_STATUS_COLORS, REPAIR_ITEM_TYPE_LABELS, REPAIR_ORDER_STATUS_STEPS, isRepairOrderAcceptable } from '@/types/repair';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatCurrency } from '@/lib/formatters';
import { useReactToPrint } from 'react-to-print';
import { cn } from '@/lib/utils';
import { useRepairBase } from '@/lib/repairBase';

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
  const printRef = useRef<HTMLDivElement>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [isDeductingAll, setIsDeductingAll] = useState(false);

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

  const ReceiptContent = () => (
    <div ref={printRef} className="bg-white p-6 max-w-[320px] mx-auto text-sm" style={{ fontFamily: 'monospace' }}>
      <div className="text-center border-b pb-3 mb-3">
        <h2 className="text-lg font-bold">維修收據</h2>
        <p className="text-xs text-gray-500">Repair Receipt</p>
      </div>

      <div className="mb-3 pb-3 border-b">
        <div className="flex justify-between">
          <span className="font-bold">單號:</span>
          <span>{order.code}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-bold">日期:</span>
          <span>{formatDate(order.created_at)}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-bold">狀態:</span>
          <span>{REPAIR_ORDER_STATUS_LABELS[order.status as keyof typeof REPAIR_ORDER_STATUS_LABELS]}</span>
        </div>
      </div>

      <div className="mb-3 pb-3 border-b">
        <div className="font-bold mb-1">客戶資訊</div>
        <div className="flex justify-between">
          <span>姓名:</span>
          <span>{order.customer_name}</span>
        </div>
        {order.customer_phone && (
          <div className="flex justify-between">
            <span>電話:</span>
            <span>{order.customer_phone}</span>
          </div>
        )}
      </div>

      <div className="mb-3 pb-3 border-b">
        <div className="font-bold mb-1">裝置資訊</div>
        <div className="flex justify-between">
          <span>型號:</span>
          <span>{order.device_model?.name || '-'}</span>
        </div>
        {order.device_color && (
          <div className="flex justify-between">
            <span>顏色:</span>
            <span>{order.device_color}</span>
          </div>
        )}
        {order.device_storage && (
          <div className="flex justify-between">
            <span>容量:</span>
            <span>{order.device_storage}</span>
          </div>
        )}
        {order.device_imei && (
          <div className="flex justify-between">
            <span>IMEI:</span>
            <span className="text-[10px]">{order.device_imei}</span>
          </div>
        )}
      </div>

      {order.reported_issue && (
        <div className="mb-3 pb-3 border-b">
          <div className="font-bold mb-1">問題描述</div>
          <p className="text-xs">{order.reported_issue}</p>
        </div>
      )}

      <div className="mb-3 pb-3 border-b">
        <div className="font-bold mb-1">維修項目</div>
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 py-1">無維修項目</p>
        ) : (
          items.map((item: any, idx: number) => {
            const isPart = item.item_type === 'part' || (!item.item_type && !!(item.product_id || item.variant_id));
            const itemName = (isPart
              ? (item.part_name || item.variant?.name || (item.product?.name ? `${item.product.name}${item.variant?.name ? ` - ${item.variant.name}` : ''}` : '') || item.service_name)
              : (item.service_name || item.part_name)) || '維修項目';
            return (
              <div key={item.id || idx} className="flex justify-between text-xs py-0.5">
                <span className="flex-1">
                  {isPart ? '[零件]' : '[服務]'} {itemName}
                  {(item.quantity || 1) > 1 ? ` x${item.quantity}` : ''}
                </span>
                <span className="font-mono">{formatCurrency(((item.unit_price || 0) * (item.quantity || 1)))}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="mb-3 pb-3 border-b">
        <div className="flex justify-between font-bold">
          <span>總金額</span>
          <span>{formatCurrency(finalPrice)}</span>
        </div>
        {order.discount > 0 && (
          <div className="flex justify-between text-xs text-gray-500">
            <span>折扣</span>
            <span>-{formatCurrency(order.discount)}</span>
          </div>
        )}
        {order.deposit > 0 && (
          <div className="flex justify-between text-xs">
            <span>已付定金</span>
            <span>{formatCurrency(order.deposit)}</span>
          </div>
        )}
        {order.deposit > 0 && (
          <div className="flex justify-between text-xs font-bold text-blue-600">
            <span>尚欠金額</span>
            <span>{formatCurrency(finalPrice - order.deposit)}</span>
          </div>
        )}
      </div>

      {order.diagnostic_result && (
        <div className="mb-3 pb-3 border-b">
          <div className="font-bold mb-1">檢測結果</div>
          <p className="text-xs">{order.diagnostic_result}</p>
        </div>
      )}

      <div className="text-center text-[10px] text-gray-400 mt-4">
        <p>感謝您的信任與支持</p>
        <p>如有任何問題請憑此單洽詢</p>
      </div>
    </div>
  );

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
            </div>
            <p className="text-sm text-muted-foreground">建立於 {formatDate(order.created_at)}</p>
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
          <ReceiptContent />
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
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <User className="h-4 w-4" />
                    客戶資訊
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-muted-foreground">姓名</span>
                    <p className="font-medium">{order.customer_name}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">電話</span>
                    <p className="font-medium">{order.customer_phone || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Email</span>
                    <p className="font-medium">{order.customer_email || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">備註</span>
                    <p className="font-medium">{order.customer_notes || '-'}</p>
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
                <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <span className="text-xs text-muted-foreground">型號</span>
                    <p className="font-medium">{order.device_model?.name || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">品牌</span>
                    <p className="font-medium">{order.device_model?.brand?.name || order.device_brand?.brand_id?.name || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">顏色</span>
                    <p className="font-medium">{order.device_color || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">儲存空間</span>
                    <p className="font-medium">{order.device_storage || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">RAM</span>
                    <p className="font-medium">{order.device_ram || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">CPU</span>
                    <p className="font-medium">{order.device_specs?.cpu || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">IMEI</span>
                    <p className="font-medium font-mono text-sm">{order.device_imei || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">序號</span>
                    <p className="font-medium font-mono text-sm">{order.device_sn || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">解鎖方式</span>
                    <p className="font-medium">
                      {order.device_lock_type === 'numeric' && '數字密碼'}
                      {order.device_lock_type === 'pattern' && '圖形鎖'}
                      {(!order.device_lock_type || order.device_lock_type === 'none') && '無密碼'}
                    </p>
                  </div>
                  {(order.device_lock_type === 'numeric' || order.device_lock_type === 'pattern') && (
                    <div>
                      <span className="text-xs text-muted-foreground">解鎖內容</span>
                      {order.device_lock_type === 'numeric' ? (
                        <p className="font-medium font-mono">{order.device_passcode || '-'}</p>
                      ) : (
                        <p className="font-medium font-mono">{order.device_passcode_pattern?.split('').join(' → ') || '-'}</p>
                      )}
                    </div>
                  )}
                  <div className="col-span-full">
                    <span className="text-xs text-muted-foreground">外觀狀況</span>
                    <p className="font-medium">{order.device_condition || '-'}</p>
                  </div>
                </CardContent>
              </Card>

              {(order.checklists || []).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ClipboardCheck className="h-4 w-4" />
                      外觀 / 功能檢查
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">外觀檢查</p>
                      <ul className="space-y-1">
                        {order.checklists.filter((c: any) => c.category === 'appearance').map((c: any, idx: number) => (
                          <li key={c.id || idx} className="flex items-center gap-2 text-sm">
                            <span className={c.is_checked ? 'text-primary' : 'text-muted-foreground'}>
                              {c.is_checked ? '☑' : '☐'}
                            </span>
                            <span className={c.is_checked ? '' : 'text-muted-foreground line-through'}>{c.item_name}</span>
                            {c.note && <span className="text-xs text-muted-foreground">（{c.note}）</span>}
                          </li>
                        ))}
                        {(order.checklists || []).filter((c: any) => c.category === 'appearance').length === 0 && (
                          <li className="text-xs text-muted-foreground">無</li>
                        )}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">功能檢查</p>
                      <ul className="space-y-1">
                        {order.checklists.filter((c: any) => c.category === 'functional').map((c: any, idx: number) => (
                          <li key={c.id || idx} className="flex items-center gap-2 text-sm">
                            <span className={c.is_checked ? 'text-primary' : 'text-muted-foreground'}>
                              {c.is_checked ? '☑' : '☐'}
                            </span>
                            <span className={c.is_checked ? '' : 'text-muted-foreground line-through'}>{c.item_name}</span>
                            {c.note && <span className="text-xs text-muted-foreground">（{c.note}）</span>}
                          </li>
                        ))}
                        {(order.checklists || []).filter((c: any) => c.category === 'functional').length === 0 && (
                          <li className="text-xs text-muted-foreground">無</li>
                        )}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">問題與診斷</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <span className="text-xs text-muted-foreground">客戶描述</span>
                    <p className="text-sm whitespace-pre-wrap">{order.reported_issue || '無'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">檢測結果</span>
                    <p className="text-sm whitespace-pre-wrap">{order.diagnostic_result || '尚未檢測'}</p>
                  </div>
                  {order.internal_notes && (
                    <div>
                      <span className="text-xs text-muted-foreground">內部備註</span>
                      <p className="text-sm whitespace-pre-wrap text-yellow-700 bg-yellow-50 p-2 rounded">{order.internal_notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <DollarSign className="h-4 w-4" />
                    維修項目與用料
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {items.some((i: any) => {
                      const isP = i.item_type === 'part' || (!i.item_type && !!(i.product_id || i.variant_id));
                      return isP && !i.is_stock_deducted && (i.product_id || i.variant_id);
                    }) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700"
                        onClick={handleDeductAll}
                        disabled={isDeductingAll}
                      >
                        {isDeductingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
                        {isDeductingAll ? '出庫扣減中...' : '一鍵全數扣庫存'}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => navigate(`${repairBase}/${id}/edit`)}
                    >
                      <Edit className="h-3.5 w-3.5" />
                      編輯項目
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-xs">
                          <th className="text-left py-2 px-1 font-medium w-16">類型</th>
                          <th className="text-left py-2 px-2 font-medium">項目名稱 / 零件材料</th>
                          <th className="text-left py-2 px-2 font-medium">描述說明</th>
                          <th className="text-center py-2 px-2 font-medium w-14">數量</th>
                          <th className="text-right py-2 px-2 font-medium w-20">成本</th>
                          <th className="text-right py-2 px-2 font-medium w-20">售價</th>
                          <th className="text-right py-2 px-2 font-medium w-20">小計</th>
                          <th className="text-center py-2 px-2 font-medium w-28">庫存狀態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-muted-foreground">
                              <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                              <p className="text-sm">尚未新增維修項目或材料</p>
                              <Button
                                variant="outline"
                                size="sm"
                                className="mt-3 gap-1.5"
                                onClick={() => navigate(`${repairBase}/${id}/edit`)}
                              >
                                <Edit className="h-3.5 w-3.5" />
                                前往編輯添加項目
                              </Button>
                            </td>
                          </tr>
                        ) : (
                          items.map((item: any, idx: number) => {
                            const isPart = item.item_type === 'part' || (!item.item_type && !!(item.product_id || item.variant_id));
                            const itemName = (isPart
                              ? (item.part_name || item.variant?.name || (item.product?.name ? `${item.product.name}${item.variant?.name ? ` - ${item.variant.name}` : ''}` : '') || item.service_name)
                              : (item.service_name || item.part_name)) || '未命名項目';

                            const isDeductingThis = deductSinglePartMutation.isPending && (deductSinglePartMutation.variables as any)?.id === item.id;

                            return (
                              <tr key={item.id || idx} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                                <td className="py-2.5 px-1 align-top">
                                  <Badge
                                    variant={isPart ? 'default' : 'secondary'}
                                    className="text-[10px] font-normal px-1.5 py-0 select-none"
                                  >
                                    {isPart ? '零件' : '服務'}
                                  </Badge>
                                </td>
                                <td className="py-2.5 px-2 align-top">
                                  <div className="font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                                    <span>{itemName}</span>
                                    {isPart && item.purchase_order_item_id && (
                                      <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 dark:text-green-400 gap-0.5 py-0 font-normal">
                                        <Truck className="h-3 w-3" /> 已叫料
                                      </Badge>
                                    )}
                                  </div>
                                  {isPart && (item.product?.code || item.variant?.sku) && (
                                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                                      {item.product?.code ? `料號: ${item.product.code}` : ''}
                                      {item.variant?.sku ? ` (${item.variant.sku})` : ''}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 align-top text-xs text-muted-foreground max-w-[180px]">
                                  {item.description ? (
                                    <span className="line-clamp-2">{item.description}</span>
                                  ) : (
                                    <span className="text-muted-foreground/30">-</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-2 align-top text-center font-medium">
                                  {item.quantity}
                                </td>
                                <td className="py-2.5 px-2 align-top text-right font-mono text-xs text-muted-foreground">
                                  {isPart ? formatCurrency(item.unit_cost || 0) : '-'}
                                </td>
                                <td className="py-2.5 px-2 align-top text-right font-mono">
                                  {formatCurrency(item.unit_price || 0)}
                                </td>
                                <td className="py-2.5 px-2 align-top text-right font-mono font-medium">
                                  {formatCurrency((item.unit_price || 0) * (item.quantity || 1))}
                                </td>
                                <td className="py-2.5 px-2 align-top text-center">
                                  {isPart ? (
                                    item.is_stock_deducted ? (
                                      <Badge
                                        variant="secondary"
                                        className="text-[10px] font-normal bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300"
                                      >
                                        已扣庫存
                                      </Badge>
                                    ) : (item.product_id || item.variant_id) ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-[11px] px-2 py-0 gap-1 text-amber-600 border-amber-300 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:border-amber-700 shadow-none font-normal"
                                        onClick={() => deductSinglePartMutation.mutate(item)}
                                        disabled={deductSinglePartMutation.isPending || isDeductingAll}
                                        title="點擊立即扣減自有倉零件庫存"
                                      >
                                        {isDeductingThis ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <PackageCheck className="h-3 w-3" />
                                        )}
                                        扣庫存
                                      </Button>
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] font-normal text-amber-600 border-amber-300 dark:text-amber-400"
                                      >
                                        未扣庫存
                                      </Badge>
                                    )
                                  ) : (
                                    <span className="text-xs text-muted-foreground/30">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">指派與來源</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">來源店家</span>
                    <span className="font-medium">{order.store?.name || '-'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">接案人</span>
                    {order.assigned_to && assignees[order.assigned_to]?.email ? (
                      <span className="font-medium">{assignees[order.assigned_to]?.email}</span>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">開放待接案</Badge>
                    )}
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
                    <span className="font-mono">{formatCurrency(totalPartsCost)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">工資收入</span>
                    <span className="font-mono">{formatCurrency(order.labor_fee || 0)}</span>
                  </div>
                  {order.discount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">折扣</span>
                      <span className="font-mono text-red-500">-{formatCurrency(order.discount)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-bold text-base">
                    <span>應收總額</span>
                    <span className="font-mono">{formatCurrency(finalPrice)}</span>
                  </div>
                  {order.deposit > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">已收定金</span>
                      <span className="font-mono text-blue-600">{formatCurrency(order.deposit)}</span>
                    </div>
                  )}
                  {order.deposit > 0 && (
                    <div className="flex justify-between font-bold text-sm text-blue-700">
                      <span>待收款</span>
                      <span className="font-mono">{formatCurrency(finalPrice - order.deposit)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">利潤</span>
                    <span className={`font-mono font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(profit)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">毛利率</span>
                    <span className={`font-mono ${Number(profitPercent) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {profitPercent}%
                    </span>
                  </div>
                  {order.payment_method && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">付款方式</span>
                      <span>{order.payment_method}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Clock className="h-4 w-4" />
                    時間紀錄
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">建立</span>
                    <span>{formatDate(order.created_at)}</span>
                  </div>
                  {order.diagnosed_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">檢測完成</span>
                      <span>{formatDate(order.diagnosed_at)}</span>
                    </div>
                  )}
                  {order.started_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">開始維修</span>
                      <span>{formatDate(order.started_at)}</span>
                    </div>
                  )}
                  {order.completed_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">維修完成</span>
                      <span>{formatDate(order.completed_at)}</span>
                    </div>
                  )}
                  {order.delivered_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">取件時間</span>
                      <span>{formatDate(order.delivered_at)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="h-4 w-4" />
                    狀態紀錄
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(order.status_history || []).map((h: any, idx: number) => (
                    <div key={h.id || idx} className="flex justify-between items-start text-xs py-1 border-b last:border-0">
                      <div>
                        <span className="font-medium">
                          {REPAIR_ORDER_STATUS_LABELS[h.to_status as keyof typeof REPAIR_ORDER_STATUS_LABELS] || h.to_status}
                        </span>
                        {h.changed_by && assignees[h.changed_by]?.email && (
                          <span className="text-muted-foreground ml-1">- {assignees[h.changed_by]?.email}</span>
                        )}
                      </div>
                      <span className="text-muted-foreground">{formatDate(h.created_at)}</span>
                    </div>
                  ))}
                  {(order.status_history || []).length === 0 && (
                    <p className="text-xs text-muted-foreground text-center">尚無狀態變更紀錄</p>
                  )}
                </CardContent>
              </Card>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => navigate(`${repairBase}/${id}/edit`)}>
                  <Edit className="mr-2 h-4 w-4" />
                  編輯
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setShowReceipt(true)}>
                  <Printer className="mr-2 h-4 w-4" />
                  收據
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
