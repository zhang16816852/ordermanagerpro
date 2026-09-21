import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Save, Package } from 'lucide-react';
import { useDeliveryMethods, DeliveryMethodPicker } from '@/components/shipping/DeliveryMethodPicker';
import { useShipments, useShipmentMutations, ShipmentRow, ShipmentDocType } from '@/hooks/useShipments';
import { formatCurrency } from '@/lib/formatters';

interface ParcelDraft {
  key: string;
  shipmentId?: string | null;
  deliveryMethodId: string | null;
  fee: string;
  cost: string;
  trackingCompany: string;
  trackingNumber: string;
  trackingUrl: string;
  note: string;
}

function toDraft(s: ShipmentRow): ParcelDraft {
  return {
    key: s.id,
    shipmentId: s.id,
    deliveryMethodId: s.delivery_method_id,
    fee: s.fee != null ? String(s.fee) : '',
    cost: s.cost != null ? String(s.cost) : '',
    trackingCompany: s.tracking_company || '',
    trackingNumber: s.tracking_number || '',
    trackingUrl: s.tracking_url || '',
    note: s.note || '',
  };
}

function fromDraft(s: ShipmentRow, d: ParcelDraft): boolean {
  return (
    (s.delivery_method_id ?? null) !== d.deliveryMethodId ||
    (s.fee != null ? String(s.fee) : '') !== d.fee ||
    (s.cost != null ? String(s.cost) : '') !== d.cost ||
    (s.tracking_company || '') !== d.trackingCompany ||
    (s.tracking_number || '') !== d.trackingNumber ||
    (s.tracking_url || '') !== d.trackingUrl ||
    (s.note || '') !== d.note
  );
}

// 包裹管理卡片：依 doc_type/doc_id 列出 shipments，可新增/編輯/刪除
// editable=false 時為唯讀清單（門市端等）
export function ParcelManager({
  docType,
  docId,
  editable = true,
}: {
  docType: ShipmentDocType;
  docId: string | null;
  editable?: boolean;
}) {
  const { data: shipments = [] } = useShipments(docType, docId);
  const { data: methods = [] } = useDeliveryMethods();
  const { upsertMutation, deleteMutation } = useShipmentMutations(docType, docId);
  const [drafts, setDrafts] = useState<ParcelDraft[]>([]);

  // shipments 載入後若無本地草稿則以 shipments 為底（僅初始建立）
  useEffect(() => {
    if (!docId) return;
    if (!shipments.length) {
      setDrafts([]);
      return;
    }
    setDrafts((prev) => {
      const existingKeys = new Set(prev.filter((d) => d.shipmentId).map((d) => d.shipmentId));
      const fresh = shipments.filter((s) => !existingKeys.has(s.id));
      return [...prev, ...fresh.map(toDraft)];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, shipments.length]);

  const patchDraft = (key: string, patch: Partial<ParcelDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const addParcel = () =>
    setDrafts((prev) => [
      ...prev,
      { key: `new-${Date.now()}-${prev.length}`, shipmentId: null, deliveryMethodId: null, fee: '', cost: '', trackingCompany: '', trackingNumber: '', trackingUrl: '', note: '' },
    ]);

  const saveParcel = (d: ParcelDraft) => {
    upsertMutation.mutate(
      {
        shipmentId: d.shipmentId || null,
        deliveryMethodId: d.deliveryMethodId,
        fee: d.fee === '' ? null : parseFloat(d.fee),
        cost: d.cost === '' ? null : parseFloat(d.cost),
        trackingCompany: d.trackingCompany || null,
        trackingNumber: d.trackingNumber || null,
        trackingUrl: d.trackingUrl || null,
        note: d.note || null,
      },
      {
        onSuccess: () => {
          setDrafts((prev) => prev.filter((x) => x.key !== d.key));
        },
      }
    );
  };

  const removeParcel = (d: ParcelDraft) => {
    if (d.shipmentId) {
      deleteMutation.mutate(d.shipmentId, {
        onSuccess: () => setDrafts((prev) => prev.filter((x) => x.key !== d.key)),
      });
    } else {
      setDrafts((prev) => prev.filter((x) => x.key !== d.key));
    }
  };

  const visibleDrafts = useMemo(
    () => (drafts.length ? drafts : shipments.map(toDraft)),
    [drafts, shipments]
  );

  const totalFee = visibleDrafts.reduce((s, d) => s + (parseFloat(d.fee) || 0), 0);
  const methodTitle = (id: string | null) => {
    if (!id) return '（未選擇）';
    const m = methods.find((x) => x.id === id);
    return m?.name || id.slice(0, 8);
  };

  if (!docId) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Package className="h-4 w-4" />
          包裹（{visibleDrafts.length}）
        </div>
        <div className="text-sm text-muted-foreground">運費合計：{formatCurrency(totalFee)}</div>
        {editable && (
          <Button variant="outline" size="sm" onClick={addParcel}>
            <Plus className="h-4 w-4 mr-1" /> 新增包裹
          </Button>
        )}
      </div>

      {visibleDrafts.length === 0 && (
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          尚無包裹記錄
        </div>
      )}

      {visibleDrafts.map((d, idx) => {
        const original = d.shipmentId ? shipments.find((s) => s.id === d.shipmentId) : undefined;
        const dirty = editable && !!original && fromDraft(original, d);
        return (
          <div key={d.key} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">包裹 #{idx + 1}</span>
              {editable && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeParcel(d)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>

            {editable ? (
              <>
                <DeliveryMethodPicker
                  value={d.deliveryMethodId}
                  onValueChange={(v) => patchDraft(d.key, { deliveryMethodId: v })}
                  methods={methods}
                  allowNone
                />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">實收運費</Label>
                    <Input
                      type="number"
                      value={d.fee}
                      onChange={(e) => patchDraft(d.key, { fee: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">成本</Label>
                    <Input
                      type="number"
                      value={d.cost}
                      onChange={(e) => patchDraft(d.key, { cost: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">追蹤公司</Label>
                    <Input
                      value={d.trackingCompany}
                      onChange={(e) => patchDraft(d.key, { trackingCompany: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">追蹤號碼</Label>
                    <Input
                      value={d.trackingNumber}
                      onChange={(e) => patchDraft(d.key, { trackingNumber: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">追蹤網址</Label>
                  <Input
                    value={d.trackingUrl}
                    onChange={(e) => patchDraft(d.key, { trackingUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">備註</Label>
                  <Input
                    value={d.note}
                    onChange={(e) => patchDraft(d.key, { note: e.target.value })}
                  />
                </div>
                {dirty && (
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => saveParcel(d)} disabled={upsertMutation.isPending}>
                      <Save className="h-4 w-4 mr-1" /> 儲存
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{methodTitle(d.deliveryMethodId)}</span>
                  <span>{formatCurrency(parseFloat(d.fee) || 0)}</span>
                </div>
                {(d.trackingCompany || d.trackingNumber || d.trackingUrl) && (
                  <div className="text-muted-foreground truncate">
                    追蹤：{d.trackingCompany ? `${d.trackingCompany} / ` : ''}
                    {d.trackingNumber}
                    {d.trackingUrl ? `（${d.trackingUrl}）` : ''}
                  </div>
                )}
                {d.note && <div className="text-muted-foreground">{d.note}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}