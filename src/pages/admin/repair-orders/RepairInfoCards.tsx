import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Smartphone, User, ClipboardCheck } from 'lucide-react';

interface RepairInfoCardsProps {
  order: any;
}

export function RepairInfoCards({ order }: RepairInfoCardsProps) {
  return (
    <>
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
    </>
  );
}