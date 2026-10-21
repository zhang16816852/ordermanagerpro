import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { InternalProductSelector } from './InternalProductSelector';
import type { SupplierProductMapping } from '../../hooks/useSupplierMappings';

interface MappedRuleEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: SupplierProductMapping | null;
  isSaving?: boolean;
  onSave: (data: {
    id: string;
    supplier_id: string;
    vendor_product_id: string;
    vendor_product_name: string | null;
    internal_product_id: string;
    internal_variant_id: string | null;
    vendor_unit_cost: number | null;
    is_primary: boolean;
  }) => void;
}

export function MappedRuleEditDialog({ open, onOpenChange, rule, isSaving, onSave }: MappedRuleEditDialogProps) {
  const [vendorProductId, setVendorProductId] = useState(rule?.vendor_product_id || '');
  const [vendorProductName, setVendorProductName] = useState(rule?.vendor_product_name || '');
  const [vendorUnitCost, setVendorUnitCost] = useState(rule?.vendor_unit_cost?.toString() || '');
  const [internalProductId, setInternalProductId] = useState(rule?.internal_product_id || '');
  const [internalVariantId, setInternalVariantId] = useState<string | null>(rule?.internal_variant_id || null);
  const [internalLabel, setInternalLabel] = useState(
    rule?.internal_variant?.name || rule?.internal_product?.name || '未知產品',
  );
  const [productOpen, setProductOpen] = useState(false);

  useEffect(() => {
    if (rule && open) {
      setVendorProductId(rule.vendor_product_id);
      setVendorProductName(rule.vendor_product_name || '');
      setVendorUnitCost(rule.vendor_unit_cost?.toString() || '');
      setInternalProductId(rule.internal_product_id);
      setInternalVariantId(rule.internal_variant_id);
      setInternalLabel(rule.internal_variant?.name || rule.internal_product?.name || '未知產品');
      setProductOpen(false);
    }
  }, [rule, open]);

  if (!rule) return null;

  const handleSave = () => {
    if (!vendorProductId.trim() || !internalProductId) return;
    onSave({
      id: rule.id,
      supplier_id: rule.supplier_id,
      vendor_product_id: vendorProductId,
      vendor_product_name: vendorProductName || null,
      internal_product_id: internalProductId,
      internal_variant_id: internalVariantId,
      vendor_unit_cost: vendorUnitCost ? Number(vendorUnitCost) : null,
      is_primary: rule.is_primary,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>編輯產品對照</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>廠商產品代號 *</Label>
            <Input
              value={vendorProductId}
              onChange={(e) => setVendorProductId(e.target.value)}
              placeholder="例如: IMOSCASEII_I17P"
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label>廠商產品名稱</Label>
            <Input
              value={vendorProductName}
              onChange={(e) => setVendorProductName(e.target.value)}
              placeholder="廠商端的產品名稱"
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label>進貨價</Label>
            <Input
              type="number"
              value={vendorUnitCost}
              onChange={(e) => setVendorUnitCost(e.target.value)}
              placeholder="0"
              className="w-32"
            />
          </div>
          <div className="space-y-2">
            <Label>系統內部產品 *</Label>
            <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
              <span className="text-sm font-medium flex-1">{internalLabel}</span>
              <Button variant="outline" size="sm" onClick={() => setProductOpen((o) => !o)}>
                {productOpen ? '收合' : '變更'}
              </Button>
            </div>
            {productOpen && (
              <div className="border rounded-md p-2 max-h-[320px] overflow-y-auto">
                <InternalProductSelector
                  onSelect={(productId, variantId, productName, variantName) => {
                    setInternalProductId(productId);
                    setInternalVariantId(variantId);
                    setInternalLabel(variantName || productName);
                    setProductOpen(false);
                  }}
                  onClose={() => setProductOpen(false)}
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={!vendorProductId.trim() || !internalProductId || isSaving}>
            {isSaving ? '儲存中...' : '儲存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}