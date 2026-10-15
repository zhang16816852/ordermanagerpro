import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DeliveryType, DeliveryTypePicker, DeliveryMethodPicker, useDeliveryMethods,
} from '@/components/shipping/DeliveryMethodPicker';
import { getDeliveryMethodTypeLabel } from '@/components/shipping/DeliveryMethodPicker';

export interface ShippingDeliveryValue {
  deliveryType: DeliveryType | null;
  deliveryMethodId: string | null;
  trackingCompany: string;
  trackingNumber: string;
  trackingUrl: string;
  /** 運費（顧客實收）；僅在方法覆寫時使用，null/undefined 代表沿用物流方式預設 */
  shippingFee?: number | null;
  /** 物流成本；僅在方法覆寫時使用，null/undefined 代表沿用物流方式預設 */
  shippingCost?: number | null;
}

export const EMPTY_SHIPPING_DELIVERY: ShippingDeliveryValue = {
  deliveryType: null,
  deliveryMethodId: null,
  trackingCompany: '',
  trackingNumber: '',
  trackingUrl: '',
};

interface ShippingDeliveryFieldsProps {
  value: ShippingDeliveryValue;
  onChange: (v: ShippingDeliveryValue) => void;
  showTracking?: boolean;
  /** 顯示運費／成本輸入欄位（預設 false，維持既有呼叫端行為不變） */
  showFee?: boolean;
  disabled?: boolean;
  className?: string;
}

const parseNum = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// 配送欄位共用組件：型態選擇器 +（logistics 時）物流方式與追蹤欄位
export function ShippingDeliveryFields({
  value,
  onChange,
  showTracking = true,
  showFee = false,
  disabled,
  className,
}: ShippingDeliveryFieldsProps) {
  const { data: deliveryMethods = [] } = useDeliveryMethods({ includeInactive: true });

  const logisticsMethods = useMemo(
    () => deliveryMethods.filter((m) => m.type === 'logistics'),
    [deliveryMethods],
  );

  const set = (patch: Partial<ShippingDeliveryValue>) => onChange({ ...value, ...patch });
  const isLogistics = value.deliveryType === 'logistics';

  // 選擇物流方式時，若開啟運費欄位則以該方式預設價／成本預填
  const setMethod = (mid: string | null) => {
    if (showFee) {
      const m = logisticsMethods.find((x) => x.id === mid);
      set({ deliveryMethodId: mid, shippingFee: m?.price ?? null, shippingCost: m?.cost ?? null });
    } else {
      set({ deliveryMethodId: mid });
    }
  };

  return (
    <div className={className ? `space-y-3 ${className}` : 'space-y-3'}>
      <DeliveryTypePicker
        value={value.deliveryType}
        onValueChange={(t) => onChange({ ...value, deliveryType: t })}
        disabled={disabled}
        className="w-full"
      />
      {isLogistics && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="text-sm font-medium">物流方式（出貨時自動建立 1 個包裹）</div>
          <div className="space-y-1.5">
            <Label>物流方式</Label>
            <DeliveryMethodPicker
              value={value.deliveryMethodId}
              onValueChange={setMethod}
              methods={logisticsMethods}
              placeholder="選擇物流方式"
              disabled={disabled}
              className="w-full"
            />
          </div>
          {showFee && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>運費（顧客實收）</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={value.shippingFee ?? ''}
                  onChange={(e) => set({ shippingFee: parseNum(e.target.value) })}
                  placeholder="0"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label>物流成本</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={value.shippingCost ?? ''}
                  onChange={(e) => set({ shippingCost: parseNum(e.target.value) })}
                  placeholder="0"
                  disabled={disabled}
                />
              </div>
            </div>
          )}
          {showTracking && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>追蹤公司</Label>
                  <Input
                    value={value.trackingCompany}
                    onChange={(e) => set({ trackingCompany: e.target.value })}
                    placeholder="如：郵局、順豐"
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>追蹤號碼</Label>
                  <Input
                    value={value.trackingNumber}
                    onChange={(e) => set({ trackingNumber: e.target.value })}
                    placeholder="如：TEST-1234"
                    disabled={disabled}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>追蹤網址（選擇性）</Label>
                <Input
                  value={value.trackingUrl}
                  onChange={(e) => set({ trackingUrl: e.target.value })}
                  placeholder="https://…"
                  disabled={disabled}
                />
              </div>
            </>
          )}
          {!value.deliveryMethodId && (
            <div className="text-xs text-amber-600">
              {logisticsMethods.length === 0
                ? '目前沒有啟用的物流方式，請先到「物流管理」建立。'
                : '請選擇物流方式，否則不會建立包裹。'}
            </div>
          )}
        </div>
      )}
      {!disabled && isLogistics && value.deliveryMethodId && (
        <div className="text-xs text-muted-foreground">
          出貨時將自動建立 1 個包裹（方式「{getDeliveryMethodTypeLabel('logistics')}」），
          {showFee ? '費用與成本可於上方調整。' : '費用與成本取自所選物流方式。'}
        </div>
      )}
    </div>
  );
}