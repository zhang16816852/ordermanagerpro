import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useConsignment } from '../hooks/useConsignment';
import { ConsignmentOrder } from '../types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ShippingDeliveryFields,
  ShippingDeliveryValue,
  EMPTY_SHIPPING_DELIVERY,
} from '@/components/shipping/ShippingDeliveryFields';
import {
  ShippingAddressFields,
  ShippingAddressValue,
  isEmptyShippingAddress,
} from '@/components/shipping/ShippingAddressFields';
import { useStoreDeliveryDefaults } from '@/hooks/useStoreDeliveryDefaults';
import { DeliveryType } from '@/components/shipping/DeliveryMethodPicker';

interface ShipDialogProps {
  order: ConsignmentOrder;
  onCancel: () => void;
}

interface StoreInfoWithAddress {
  id: string;
  name: string;
  phone: string | null;
  recipient: string | null;
  brand: string | null;
  postal_code: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  default_delivery_method_id: string | null;
  default_delivery_type: DeliveryType | null;
}

const emptyAddress: ShippingAddressValue = {
  recipient: '',
  phone: '',
  postal_code: '',
  city: '',
  district: '',
  address: '',
};

export function ShipDialog({ order, onCancel }: ShipDialogProps) {
  const { shipMutation } = useConsignment();
  const storeId = order.store_id || null;
  const { fromStore } = useStoreDeliveryDefaults();
  const [note, setNote] = useState('');
  const [delivery, setDelivery] = useState<ShippingDeliveryValue>(EMPTY_SHIPPING_DELIVERY);
  const [shippingAddress, setShippingAddress] = useState<ShippingAddressValue>(emptyAddress);
  const [syncToStore, setSyncToStore] = useState(false);

  const { data: storeInfo } = useQuery<StoreInfoWithAddress | null>({
    queryKey: ['store-info', storeId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('stores') as any)
        .select(
          'id, name, phone, recipient, brand, postal_code, city, district, address, default_delivery_method_id, default_delivery_type'
        )
        .eq('id', storeId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!storeId,
    staleTime: Infinity,
  });

  const orderRef = useRef(order);
  orderRef.current = order;
  const storeInfoRef = useRef(storeInfo);
  storeInfoRef.current = storeInfo;
  // 訂單既有配送資訊只套用一次；店家資料非同步載入完成後再補上店家預設（不覆寫使用者已選）
  const didInitRef = useRef(false);

  // 初始化：訂單既有配送資訊 → 店家預設 → 預設 delivery（storeInfo 載入完成時補套店家預設）
  useEffect(() => {
    const o = orderRef.current;
    const store = storeInfoRef.current;
    const storeDefault = store ? fromStore(store) : null;
    if (!didInitRef.current) {
      didInitRef.current = true;
      const baseType = (o.delivery_type as DeliveryType | null) || storeDefault?.type || 'delivery';
      setDelivery({
        deliveryType: baseType,
        deliveryMethodId: o.delivery_method_id || storeDefault?.method?.id || null,
        trackingCompany: o.delivery_method_title || '',
        trackingNumber: '',
        trackingUrl: '',
      });
      // 收件地址繼承：寄賣單快照 → 店家最新地址 → 空
      const snap = o.shipping_address as Record<string, unknown> | null | undefined;
      const addr =
        (snap && !isEmptyShippingAddress({ ...emptyAddress, ...(snap as any) }) ? snap : null) ||
        (store && store.address ? {
          recipient: store.recipient || store.name || '',
          phone: store.phone || '',
          postal_code: store.postal_code || '',
          city: store.city || '',
          district: store.district || '',
          address: store.address || '',
        } : null);
      setShippingAddress({
        recipient: (addr?.recipient as string) || '',
        phone: (addr?.phone as string) || '',
        postal_code: (addr?.postal_code as string) || '',
        city: (addr?.city as string) || '',
        district: (addr?.district as string) || '',
        address: (addr?.address as string) || '',
      });
      setSyncToStore(false);
      return;
    }
    // 店家資料到齊後：無自選配送方式時補店家預設；地址仍空白時以店家最新地址預填
    if (store) {
      setDelivery((prev) => {
        if (prev.deliveryMethodId) return prev;
        return {
          ...prev,
          deliveryType: prev.deliveryType || storeDefault?.type || 'delivery',
          deliveryMethodId: storeDefault?.method?.id || null,
        };
      });
      setShippingAddress((prev) => {
        if (!isEmptyShippingAddress(prev)) return prev;
        return store.address
          ? {
              recipient: store.recipient || store.name || '',
              phone: store.phone || '',
              postal_code: store.postal_code || '',
              city: store.city || '',
              district: store.district || '',
              address: store.address || '',
            }
          : prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, storeInfo?.id]);

  // 地址與店家目前地址不同時自動勾選「同步至店鋪」（僅地址異動觸發）
  useEffect(() => {
    const store = storeInfoRef.current;
    if (!store || !storeId) return;
    const differs =
      shippingAddress.recipient !== (store.recipient || store.name || '') ||
      shippingAddress.phone !== (store.phone || '') ||
      shippingAddress.postal_code !== (store.postal_code || '') ||
      shippingAddress.city !== (store.city || '') ||
      shippingAddress.district !== (store.district || '') ||
      shippingAddress.address !== (store.address || '');
    if (differs) setSyncToStore(true);
  }, [shippingAddress, storeId, storeInfo?.id]);

  const applyStoreAddress = () => {
    const store = storeInfoRef.current;
    if (!store) return;
    setShippingAddress({
      recipient: store.recipient || store.name || '',
      phone: store.phone || '',
      postal_code: store.postal_code || '',
      city: store.city || '',
      district: store.district || '',
      address: store.address || '',
    });
    setSyncToStore(false);
  };

  const isLogistics = delivery.deliveryType === 'logistics';

  const handleSubmit = () => {
    shipMutation.mutate(
      {
        orderId: order.id,
        note,
        storeId,
        syncToStore: isLogistics && syncToStore,
        delivery: {
          deliveryType: delivery.deliveryType,
          deliveryMethodId: delivery.deliveryMethodId,
          trackingCompany: delivery.trackingCompany,
          trackingNumber: delivery.trackingNumber,
          trackingUrl: delivery.trackingUrl,
          shippingAddress: isLogistics && !isEmptyShippingAddress(shippingAddress) ? { ...shippingAddress } : null,
        },
      },
      { onSuccess: onCancel }
    );
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>出貨（{order.code}）</DialogTitle>
          <DialogDescription>
            將依剩餘數量出貨至店家（店家寄賣，不開立銷貨單），店家確認收貨後即可回報銷售。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>配送類型</Label>
            <ShippingDeliveryFields value={delivery} onChange={setDelivery} />
          </div>
          {isLogistics && storeId && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">收件地址</div>
                <Button type="button" variant="outline" size="sm" onClick={applyStoreAddress}>
                  套用店家最新地址
                </Button>
              </div>
              <ShippingAddressFields value={shippingAddress} onChange={setShippingAddress} />
              <div className="flex items-center gap-2">
                <Checkbox
                  id="consignment-ship-sync-store"
                  checked={syncToStore}
                  onCheckedChange={(v) => setSyncToStore(!!v)}
                />
                <label htmlFor="consignment-ship-sync-store" className="text-sm text-muted-foreground cursor-pointer">
                  同步收件地址至店鋪（自動更新店家地址）
                </label>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>備註（選填）</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="輸入出貨備註" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleSubmit}
            disabled={shipMutation.isPending || (isLogistics && !delivery.deliveryMethodId)}
          >
            {shipMutation.isPending ? '處理中…' : '確認出貨'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}