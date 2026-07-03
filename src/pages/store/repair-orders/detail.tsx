import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Smartphone, User, DollarSign, Printer } from 'lucide-react';
import { useRepairOrderDetail } from '@/hooks/useRepairOrders';
import { REPAIR_ORDER_STATUS_LABELS, REPAIR_ORDER_STATUS_COLORS, REPAIR_ITEM_TYPE_LABELS } from '@/types/repair';
import { formatDate } from '@/lib/formatters';

export default function StoreRepairOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { order, isLoading } = useRepairOrderDetail(id || '');

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">載入中...</div>;
  if (!order) return <div className="p-8 text-center text-muted-foreground">維修單不存在</div>;

  const items = order.items || [];
  const totalPartsCost = items.filter((i: any) => i.item_type === 'part').reduce((s: number, i: any) => s + (i.unit_cost * i.quantity), 0);
  const totalPrice = items.reduce((s: number, i: any) => s + (i.unit_price * i.quantity), 0);
  const finalPrice = totalPrice - (order.discount || 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard/repair-orders')}>
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
          <Button onClick={() => navigate(`/dashboard/repair-orders/${id}/edit`)}>
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
                <span className="text-xs text-muted-foreground">顏色</span>
                <p className="font-medium">{order.device_color || '-'}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">容量</span>
                <p className="font-medium">{order.device_storage || '-'}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">IMEI</span>
                <p className="font-medium font-mono text-sm">{order.device_imei || '-'}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">密碼</span>
                <p className="font-medium">{order.device_passcode || '-'}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">外觀</span>
                <p className="font-medium">{order.device_condition || '-'}</p>
              </div>
            </CardContent>
          </Card>

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
            <CardHeader>
              <CardTitle className="text-base">維修項目</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2">項目</th>
                    <th className="text-center py-2">數量</th>
                    <th className="text-right py-2">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, idx: number) => (
                    <tr key={item.id || idx} className="border-b last:border-0">
                      <td className="py-2">
                        <span className="font-medium">{item.service_name || item.part_name || '-'}</span>
                        {item.description && <span className="text-xs text-muted-foreground ml-2">{item.description}</span>}
                      </td>
                      <td className="py-2 text-center">{item.quantity}</td>
                      <td className="py-2 text-right font-mono">${((item.unit_price || 0) * item.quantity).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">費用</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">零件成本</span>
                <span className="font-mono">${totalPartsCost.toLocaleString()}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span>應收總額</span>
                <span className="font-mono">${finalPrice.toLocaleString()}</span>
              </div>
              {order.deposit > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">已付定金</span>
                  <span className="font-mono">${order.deposit.toLocaleString()}</span>
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
