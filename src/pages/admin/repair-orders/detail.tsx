import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Edit, Printer, Smartphone, User, DollarSign, Clock, History } from 'lucide-react';
import { useRepairOrderDetail } from '@/hooks/useRepairOrders';
import { REPAIR_ORDER_STATUS_LABELS, REPAIR_ORDER_STATUS_COLORS, REPAIR_ITEM_TYPE_LABELS, REPAIR_ORDER_STATUS_STEPS } from '@/types/repair';
import { formatDate } from '@/lib/formatters';
import { useReactToPrint } from 'react-to-print';

const STATUS_STEPS = REPAIR_ORDER_STATUS_STEPS;

export default function AdminRepairOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { order, isLoading } = useRepairOrderDetail(id || '');
  const printRef = useRef<HTMLDivElement>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    pageStyle: '@page { size: 80mm auto; margin: 0; } @media print { body { -webkit-print-color-adjust: exact; } }',
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">載入中...</div>;
  if (!order) return <div className="p-8 text-center text-muted-foreground">維修單不存在</div>;

  const currentStepIndex = STATUS_STEPS.indexOf(order.status);
  const items = order.items || [];
  const totalPartsCost = items.filter((i: any) => i.item_type === 'part').reduce((s: number, i: any) => s + (i.unit_cost * i.quantity), 0);
  const totalPrice = items.reduce((s: number, i: any) => s + (i.unit_price * i.quantity), 0);
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
        {items.map((item: any, idx: number) => (
          <div key={item.id || idx} className="flex justify-between text-xs py-0.5">
            <span className="flex-1">
              {item.item_type === 'service' ? '[服務]' : '[零件]'} {item.service_name || item.part_name}
              {item.quantity > 1 ? ` x${item.quantity}` : ''}
            </span>
            <span className="font-mono">${(item.unit_price * item.quantity).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div className="mb-3 pb-3 border-b">
        <div className="flex justify-between font-bold">
          <span>總金額</span>
          <span>${finalPrice.toLocaleString()}</span>
        </div>
        {order.discount > 0 && (
          <div className="flex justify-between text-xs text-gray-500">
            <span>折扣</span>
            <span>-${order.discount.toLocaleString()}</span>
          </div>
        )}
        {order.deposit > 0 && (
          <div className="flex justify-between text-xs">
            <span>已付定金</span>
            <span>${order.deposit.toLocaleString()}</span>
          </div>
        )}
        {order.deposit > 0 && (
          <div className="flex justify-between text-xs font-bold text-blue-600">
            <span>尚欠金額</span>
            <span>${(finalPrice - order.deposit).toLocaleString()}</span>
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
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin/repair-orders')}>
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
          <Button variant="outline" onClick={() => setShowReceipt(!showReceipt)}>
            <Printer className="mr-2 h-4 w-4" />
            {showReceipt ? '檢視詳細' : '收據預覽'}
          </Button>
          <Button variant="outline" onClick={() => navigate(`/admin/repair-orders/${id}/edit`)}>
            <Edit className="mr-2 h-4 w-4" />
            編輯
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
                    <p className="font-medium">{order.device_brand?.brand_id?.name || '-'}</p>
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
                    <span className="text-xs text-muted-foreground">IMEI</span>
                    <p className="font-medium font-mono text-sm">{order.device_imei || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">序號</span>
                    <p className="font-medium font-mono text-sm">{order.device_sn || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">密碼</span>
                    <p className="font-medium">{order.device_passcode || '-'}</p>
                  </div>
                  <div className="col-span-full">
                    <span className="text-xs text-muted-foreground">外觀狀況</span>
                    <p className="font-medium">{order.device_condition || '-'}</p>
                  </div>
                </CardContent>
              </Card>

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
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <DollarSign className="h-4 w-4" />
                    維修項目
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left py-2">類型</th>
                        <th className="text-left py-2">名稱</th>
                        <th className="text-left py-2">描述</th>
                        <th className="text-center py-2">數量</th>
                        <th className="text-right py-2">單價</th>
                        <th className="text-right py-2">小計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item: any, idx: number) => (
                        <tr key={item.id || idx} className="border-b last:border-0">
                          <td className="py-2">
                            <Badge variant="outline" className="text-[10px]">
                              {REPAIR_ITEM_TYPE_LABELS[item.item_type as keyof typeof REPAIR_ITEM_TYPE_LABELS]}
                            </Badge>
                          </td>
                          <td className="py-2 font-medium">{item.service_name || item.part_name || '-'}</td>
                          <td className="py-2 text-muted-foreground text-xs">{item.description || '-'}</td>
                          <td className="py-2 text-center">{item.quantity}</td>
                          <td className="py-2 text-right font-mono">${(item.unit_price || 0).toLocaleString()}</td>
                          <td className="py-2 text-right font-mono font-medium">${((item.unit_price || 0) * item.quantity).toLocaleString()}</td>
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
                  <CardTitle className="text-base">費用摘要</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">零件成本</span>
                    <span className="font-mono">${totalPartsCost.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">工資收入</span>
                    <span className="font-mono">${order.labor_fee?.toLocaleString() || '0'}</span>
                  </div>
                  {order.discount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">折扣</span>
                      <span className="font-mono text-red-500">-${order.discount.toLocaleString()}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-bold text-base">
                    <span>應收總額</span>
                    <span className="font-mono">${finalPrice.toLocaleString()}</span>
                  </div>
                  {order.deposit > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">已收定金</span>
                      <span className="font-mono text-blue-600">${order.deposit.toLocaleString()}</span>
                    </div>
                  )}
                  {order.deposit > 0 && (
                    <div className="flex justify-between font-bold text-sm text-blue-700">
                      <span>待收款</span>
                      <span className="font-mono">${(finalPrice - order.deposit).toLocaleString()}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">利潤</span>
                    <span className={`font-mono font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ${profit.toLocaleString()}
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
                        {h.changed_by_user?.email && (
                          <span className="text-muted-foreground ml-1">- {h.changed_by_user.email}</span>
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
                <Button variant="outline" className="flex-1" onClick={() => navigate(`/admin/repair-orders/${id}/edit`)}>
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
