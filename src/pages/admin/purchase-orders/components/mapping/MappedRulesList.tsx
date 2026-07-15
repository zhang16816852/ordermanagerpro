import { useState } from 'react';
import { Trash2, Pencil, Check, X, Download, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { SupplierProductMapping } from '../../hooks/useSupplierMappings';
import { MappingExportDialog } from './MappingExportDialog';
import { InternalProductSelector } from './InternalProductSelector';

interface MappedRulesListProps {
  mappings: SupplierProductMapping[];
  onDelete: (id: string) => void;
  onSave: (data: Partial<SupplierProductMapping> & { supplier_id: string; vendor_product_id: string }) => void;
  isSaving?: boolean;
  isLoading?: boolean;
  supplierId: string;
  supplierName: string;
}

export function MappedRulesList({ mappings, onDelete, onSave, isSaving, isLoading, supplierId, supplierName }: MappedRulesListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ vendor_product_id: string; vendor_product_name: string; vendor_unit_cost: string }>({
    vendor_product_id: '',
    vendor_product_name: '',
    vendor_unit_cost: '',
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addValues, setAddValues] = useState<{
    vendor_product_id: string;
    vendor_product_name: string;
    vendor_unit_cost: string;
    internal_product_id: string;
    internal_variant_id: string | null;
    internal_label: string;
  }>({
    vendor_product_id: '',
    vendor_product_name: '',
    vendor_unit_cost: '',
    internal_product_id: '',
    internal_variant_id: null,
    internal_label: '',
  });

  const startEdit = (rule: SupplierProductMapping) => {
    setEditingId(rule.id);
    setEditValues({
      vendor_product_id: rule.vendor_product_id,
      vendor_product_name: rule.vendor_product_name || '',
      vendor_unit_cost: rule.vendor_unit_cost?.toString() || '',
    });
  };

  const saveEdit = (rule: SupplierProductMapping) => {
    onSave({
      supplier_id: rule.supplier_id,
      vendor_product_id: editValues.vendor_product_id,
      vendor_product_name: editValues.vendor_product_name || null,
      internal_product_id: rule.internal_product_id,
      internal_variant_id: rule.internal_variant_id,
      vendor_unit_cost: editValues.vendor_unit_cost ? Number(editValues.vendor_unit_cost) : null,
    });
    setEditingId(null);
  };

  const resetAddForm = () => {
    setAddValues({
      vendor_product_id: '',
      vendor_product_name: '',
      vendor_unit_cost: '',
      internal_product_id: '',
      internal_variant_id: null,
      internal_label: '',
    });
  };

  const handleAdd = () => {
    if (!addValues.vendor_product_id || !addValues.internal_product_id) return;
    onSave({
      supplier_id: supplierId,
      vendor_product_id: addValues.vendor_product_id,
      vendor_product_name: addValues.vendor_product_name || null,
      internal_product_id: addValues.internal_product_id,
      internal_variant_id: addValues.internal_variant_id,
      vendor_unit_cost: addValues.vendor_unit_cost ? Number(addValues.vendor_unit_cost) : null,
    });
    resetAddForm();
    setAddOpen(false);
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">載入對照規則中...</div>;
  }

  if (mappings.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button variant="default" size="sm" onClick={() => { resetAddForm(); setAddOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> 新增對照
          </Button>
        </div>
        <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
          尚無產品對照規則，點擊上方「新增對照」建立第一筆
        </div>

        <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetAddForm(); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>新增產品對照</DialogTitle>
              <DialogDescription>
                手動建立廠商產品代號與系統內部產品的對照關係。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>廠商產品代號 *</Label>
                <Input
                  value={addValues.vendor_product_id}
                  onChange={(e) => setAddValues(prev => ({ ...prev, vendor_product_id: e.target.value }))}
                  placeholder="例如: IMOSCASEII_I17P"
                />
              </div>
              <div className="space-y-2">
                <Label>廠商產品名稱</Label>
                <Input
                  value={addValues.vendor_product_name}
                  onChange={(e) => setAddValues(prev => ({ ...prev, vendor_product_name: e.target.value }))}
                  placeholder="廠商端的產品名稱"
                />
              </div>
              <div className="space-y-2">
                <Label>單價</Label>
                <Input
                  type="number"
                  value={addValues.vendor_unit_cost}
                  onChange={(e) => setAddValues(prev => ({ ...prev, vendor_unit_cost: e.target.value }))}
                  placeholder="0"
                  className="w-32"
                />
              </div>
              <div className="space-y-2">
                <Label>系統內部產品 *</Label>
                {addValues.internal_product_id ? (
                  <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                    <span className="text-sm font-medium flex-1">{addValues.internal_label}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAddValues(prev => ({ ...prev, internal_product_id: '', internal_variant_id: null, internal_label: '' }))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <InternalProductSelector
                    onSelect={(productId, variantId, productName, variantName) => {
                      const label = variantName ? `${productName} (${variantName})` : productName;
                      setAddValues(prev => ({ ...prev, internal_product_id: productId, internal_variant_id: variantId, internal_label: label }));
                    }}
                    onClose={() => {}}
                  />
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
              <Button
                onClick={handleAdd}
                disabled={!addValues.vendor_product_id || !addValues.internal_product_id || isSaving}
              >
                {isSaving ? '儲存中...' : '確認新增'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button variant="default" size="sm" onClick={() => { resetAddForm(); setAddOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> 新增對照
        </Button>
        <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
          <Download className="h-4 w-4 mr-1" /> 匯出對照
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>廠商產品代號</TableHead>
              <TableHead>廠商產品名稱</TableHead>
              <TableHead>系統內部產品</TableHead>
              <TableHead className="w-[100px] text-right">單價</TableHead>
              <TableHead className="w-[100px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((rule) => {
              const internalProd = rule.internal_product?.name || '未知產品';
              const internalVar = rule.internal_variant?.name || '';
              const internalLabel = internalVar ? `${internalProd} (${internalVar})` : internalProd;
              const isEditing = editingId === rule.id;

              return (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">
                    {isEditing ? (
                      <Input
                        value={editValues.vendor_product_id}
                        onChange={(e) => setEditValues(prev => ({ ...prev, vendor_product_id: e.target.value }))}
                        className="h-8"
                      />
                    ) : (
                      rule.vendor_product_id
                    )}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        value={editValues.vendor_product_name}
                        onChange={(e) => setEditValues(prev => ({ ...prev, vendor_product_name: e.target.value }))}
                        className="h-8"
                        placeholder="廠商品名"
                      />
                    ) : (
                      rule.vendor_product_name || '-'
                    )}
                  </TableCell>
                  <TableCell>{internalLabel}</TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editValues.vendor_unit_cost}
                        onChange={(e) => setEditValues(prev => ({ ...prev, vendor_unit_cost: e.target.value }))}
                        className="h-8 w-24 text-right"
                        placeholder="0"
                      />
                    ) : (
                      rule.vendor_unit_cost != null ? `$${rule.vendor_unit_cost.toLocaleString()}` : '-'
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => saveEdit(rule)}
                          disabled={isSaving}
                        >
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => startEdit(rule)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive/90 h-8 w-8"
                          onClick={() => {
                            if (confirm('確定要刪除此對照規則嗎？')) {
                              onDelete(rule.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <MappingExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        mappings={mappings}
        supplierName={supplierName}
      />

      {/* Add New Mapping Dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetAddForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新增產品對照</DialogTitle>
            <DialogDescription>
              手動建立廠商產品代號與系統內部產品的對照關係。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>廠商產品代號 *</Label>
              <Input
                value={addValues.vendor_product_id}
                onChange={(e) => setAddValues(prev => ({ ...prev, vendor_product_id: e.target.value }))}
                placeholder="例如: IMOSCASEII_I17P"
              />
            </div>
            <div className="space-y-2">
              <Label>廠商產品名稱</Label>
              <Input
                value={addValues.vendor_product_name}
                onChange={(e) => setAddValues(prev => ({ ...prev, vendor_product_name: e.target.value }))}
                placeholder="廠商端的產品名稱"
              />
            </div>
            <div className="space-y-2">
              <Label>單價</Label>
              <Input
                type="number"
                value={addValues.vendor_unit_cost}
                onChange={(e) => setAddValues(prev => ({ ...prev, vendor_unit_cost: e.target.value }))}
                placeholder="0"
                className="w-32"
              />
            </div>
            <div className="space-y-2">
              <Label>系統內部產品 *</Label>
              {addValues.internal_product_id ? (
                <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                  <span className="text-sm font-medium flex-1">{addValues.internal_label}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAddValues(prev => ({ ...prev, internal_product_id: '', internal_variant_id: null, internal_label: '' }))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <InternalProductSelector
                  onSelect={(productId, variantId, productName, variantName) => {
                    const label = variantName ? `${productName} (${variantName})` : productName;
                    setAddValues(prev => ({ ...prev, internal_product_id: productId, internal_variant_id: variantId, internal_label: label }));
                  }}
                  onClose={() => {}}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
            <Button
              onClick={handleAdd}
              disabled={!addValues.vendor_product_id || !addValues.internal_product_id || isSaving}
            >
              {isSaving ? '儲存中...' : '確認新增'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
