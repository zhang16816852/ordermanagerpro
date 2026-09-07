import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Smartphone, User, DollarSign, Printer } from 'lucide-react';
import { useRepairOrderDetail, useRepairOrders, useRepairAssigneeMap } from '@/hooks/useRepairOrders';
import { REPAIR_ORDER_STATUS_LABELS, REPAIR_ORDER_STATUS_COLORS, REPAIR_ITEM_TYPE_LABELS } from '@/types/repair';
import { formatDate, formatCurrency } from '@/lib/formatters';

export default function StoreRepairOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { order, isLoading } = useRepairOrderDetail(id || '');
  const { deliverMutation } = useRepairOrders();
  const assignees = useRepairAssigneeMap();

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">載入中...</div>;
  if (!order) return <div className="p-8 text-center text-muted-foreground">維修單不存在</div>;

  const items = [...(order.items || [])].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const totalPartsCost = items.filter((i: any) => i.item_type === 'part' || (!i.item_type && !!(i.product_id || i.variant_id))).reduce((s: number, i: any) => s + ((i.unit_cost || 0) * (i.quantity || 1)), 0);
  const calculatedTotalPrice = items.reduce((s: number, i: any) => s + ((i.unit_price || 0) * (i.quantity || 1)), 0);
  const totalPrice = calculatedTotalPrice || order.total_price || 0;
  const finalPrice = totalPrice - (order.discount || 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard/repair-orders')} aria-label="返回維修單列表">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight font-mono">{order.code}</h1>
              <Badge className={REPAIR_ORDER_STATUS_COLORS[order.status as keyof typeof REPAIR_ORDER_STATUS_COLORS]}>
                {REPAIR_ORDER_STATUS_LABELS[order.status as keyof typeof REPAIR_ORDER_STATUS_LABELS]}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{formatDate(order.created_at)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            列印
          </Button>
          {order.status === 'ready' && (
            <Button onClick={() => deliverMutation.mutate(order.id)}>
              交還客戶
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate(`/dashboard/repair-orders/${id}/edit`)}>
            編輯
          </Button>
        </div>
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
                <span className="text-xs text-muted-foreground">容量</span>
                <p className="font-medium">{order.device_storage || '-'}</p>
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
                <span className="text-xs text-muted-foreground">解鎖</span>
                <p className="font-mono text-sm">
                  {order.device_lock_type === 'numeric' && order.device_passcode}
                  {order.device_lock_type === 'pattern' && order.device_passcode_pattern?.split('').join(' → ')}
                  {(!order.device_lock_type || order.device_lock_type === 'none') && '-'}
                </p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">外觀</span>
                <p className="font-medium">{order.device_condition || '-'}</p>
              </div>
            </CardContent>
          </Card>

          {(order.checklists || []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">外觀 / 功能檢查</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(['appearance', 'functional'] as const).map(category => (
                  <div key={category}>
                    <p className="text-xs text-muted-foreground mb-1">{category === 'appearance' ? '外觀檢查' : '功能檢查'}</p>
                    <ul className="space-y-1">
                      {order.checklists.filter((c: any) => c.category === category).map((c: any, idx: number) => (
                        <li key={c.id || idx} className="flex items-center gap-2 text-sm">
                          <span className={c.is_checked ? 'text-primary' : 'text-muted-foreground'}>{c.is_checked ? '☑' : '☐'}</span>
                          <span className={c.is_checked ? '' : 'text-muted-foreground line-through'}>{c.item_name}</span>
                          {c.note && <span className="text-xs text-muted-foreground">（{c.note}）</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">問題描述</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{order.reported_issue || '無'}</p>
              {order.diagnostic_result && (
                <div className="mt-3">
                  <span className="text-xs text-muted-foreground">檢測結果</span>
                  <p className="text-sm whitespace-pre-wrap">{order.diagnostic_result}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="h-4 w-4" />
                維修項目
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 px-1 w-16">類型</th>
                    <th className="text-left py-2 px-2">項目名稱</th>
                    <th className="text-center py-2 px-2 w-16">數量</th>
                    <th className="text-right py-2 px-2 w-24">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted-foreground text-xs">
                        尚無維修項目
                      </td>
                    </tr>
                  ) : (
                    items.map((item: any, idx: number) => {
                      const isPart = item.item_type === 'part' || (!item.item_type && !!(item.product_id || item.variant_id));
                      const itemName = (isPart
                        ? (item.part_name || item.variant?.name || (item.product?.name ? `${item.product.name}${item.variant?.name ? ` - ${item.variant.name}` : ''}` : '') || item.service_name)
                        : (item.service_name || item.part_name)) || '未命名項目';

                      return (
                        <tr key={item.id || idx} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="py-2.5 px-1 align-top">
                            <Badge variant={isPart ? 'default' : 'secondary'} className="text-[10px] font-normal px-1.5 py-0 select-none">
                              {isPart ? '零件' : '服務'}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-2 align-top">
                            <span className="font-medium text-foreground">{itemName}</span>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                            )}
                          </td>
                          <td className="py-2.5 px-2 align-top text-center font-medium">{item.quantity}</td>
                          <td className="py-2.5 px-2 align-top text-right font-mono font-medium">
                            {formatCurrency(((item.unit_price || 0) * (item.quantity || 1)))}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">指派</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
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
              <CardTitle className="text-base">費用</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">零件成本</span>
                <span className="font-mono">{formatCurrency(totalPartsCost)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span>應收總額</span>
                <span className="font-mono">{formatCurrency(finalPrice)}</span>
              </div>
              {order.deposit > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">已付定金</span>
                  <span className="font-mono">{formatCurrency(order.deposit)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">時間</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">建立時間</span>
                <span>{formatDate(order.created_at)}</span>
              </div>
              {order.completed_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">完成時間</span>
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
        </div>
      </div>
    </div>
  );
}
