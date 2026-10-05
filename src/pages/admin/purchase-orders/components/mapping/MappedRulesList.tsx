import { useState, useMemo } from 'react';
import { Trash2, Pencil, Check, X, Download, Plus, Upload, Search, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { SupplierProductMapping } from '../../hooks/useSupplierMappings';
import { MappingExportDialog } from './MappingExportDialog';
import { MappingImportDialog } from './MappingImportDialog';
import { InternalProductSelector } from './InternalProductSelector';
import { formatCurrency } from '@/lib/formatters';

interface MappedRulesListProps {
  mappings: SupplierProductMapping[];
  onDelete: (id: string) => void;
  onSave: (data: Partial<SupplierProductMapping> & { supplier_id: string; vendor_product_id: string }) => void;
  /** 將指定對照設為該廠商代號的主對照（採購匯入與成本查詢的預設目標） */
  onSetPrimary: (id: string) => void;
  isSaving?: boolean;
  isSettingPrimary?: boolean;
  isLoading?: boolean;
  supplierId: string;
  supplierName: string;
}

export function MappedRulesList({ mappings, onDelete, onSave, onSetPrimary, isSaving, isSettingPrimary, isLoading, supplierId, supplierName }: MappedRulesListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ vendor_product_id: string; vendor_product_name: string; vendor_unit_cost: string }>({
    vendor_product_id: '',
    vendor_product_name: '',
    vendor_unit_cost: '',
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addValues, setAddValues] = useState<{
    vendor_product_id: string;
    vendor_product_name: string;
    vendor_unit_cost: string;
    internal_product_id: string;
    internal_variant_id: string | null;
    internal_label: string;
    is_primary: boolean;
  }>({
    vendor_product_id: '',
    vendor_product_name: '',
    vendor_unit_cost: '',
    internal_product_id: '',
    internal_variant_id: null,
    internal_label: '',
    is_primary: true,
  });

  /** 同一廠商代號已對應的目標數量（>1 時代表一料號對多商品／變體） */
  const targetCountByCode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of mappings) {
      const key = m.vendor_product_id.trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [mappings]);

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
      id: rule.id,
      supplier_id: rule.supplier_id,
      vendor_product_id: editValues.vendor_product_id,
      vendor_product_name: editValues.vendor_product_name || null,
      internal_product_id: rule.internal_product_id,
      internal_variant_id: rule.internal_variant_id,
      vendor_unit_cost: editValues.vendor_unit_cost ? Number(editValues.vendor_unit_cost) : null,
      is_primary: rule.is_primary,
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
      is_primary: true,
    });
  };

  /** 新增時若此廠商代號已有其他對照目標，一律以次要對照加入（主對照請用列表上的星號切換） */
  const addCodeAlreadyMapped = (targetCode: string) => {
    const code = targetCode.trim();
    if (!code) return false;
    return mappings.some((m) => m.vendor_product_id.trim() === code);
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
      is_primary: addValues.is_primary && !addCodeAlreadyMapped(addValues.vendor_product_id),
    });
    resetAddForm();
    setAddOpen(false);
  };

  const filteredMappings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mappings;
    return mappings.filter((rule) => {
      const internalProd = rule.internal_product?.name || '';
      const internalVar = rule.internal_variant?.name || '';
      return (
        (rule.vendor_product_id || '').toLowerCase().includes(q) ||
        (rule.vendor_product_name || '').toLowerCase().includes(q) ||
        internalProd.toLowerCase().includes(q) ||
        internalVar.toLowerCase().includes(q)
      );
    });
  }, [search, mappings]);

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">載入對照規則中...</div>;
  }

  if (mappings.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end gap-2">
          <Button variant="default" size="sm" onClick={() => { resetAddForm(); setAddOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> 新增對照
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-1" /> 匯入對照
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
                      aria-label="清除已選產品"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
<InternalProductSelector
                  onSelect={(productId, variantId, productName, variantName) => {
                    const label = variantName || productName;
                    setAddValues(prev => ({ ...prev, internal_product_id: productId, internal_variant_id: variantId, internal_label: label }));
                  }}
                  onClose={() => {}}
                />
              )}
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="add-is-primary"
                checked={addValues.is_primary}
                onCheckedChange={(checked) => setAddValues(prev => ({ ...prev, is_primary: checked === true }))}
              />
              <div className="space-y-1">
                <Label htmlFor="add-is-primary" className="cursor-pointer">設為主對照</Label>
                <p className="text-xs text-muted-foreground">
                  同一廠商代號可對應多個內部產品／變體，採購匯入與成本查詢預設採用主對照；若此代號已有其他對照，本筆會自動以次要對照加入。
                </p>
              </div>
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

        <MappingImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          supplierId={supplierId}
          supplierName={supplierName}
          onImportComplete={() => {
            window.location.reload();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <Button variant="default" size="sm" onClick={() => { resetAddForm(); setAddOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> 新增對照
        </Button>
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4 mr-1" /> 匯入對照
        </Button>
        <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
          <Download className="h-4 w-4 mr-1" /> 匯出對照
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋廠商代號 / 廠商名稱 / 系統產品..."
          className="pl-8"
        />
      </div>

      <div className="rounded-md border overflow-hidden">
        <ScrollArea className="h-[450px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>廠商產品代號</TableHead>
                <TableHead>廠商產品名稱</TableHead>
                <TableHead>系統內部產品</TableHead>
                <TableHead className="w-[90px] text-center">主對照</TableHead>
                <TableHead className="w-[100px] text-right">單價</TableHead>
                <TableHead className="w-[100px] text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMappings.length === 0 ? (
                <TableRow>
                  <TableCell className="text-center py-8 text-muted-foreground" colSpan={6}>
                    查無符合「{search}」的對照規則
                  </TableCell>
                </TableRow>
              ) : (
                filteredMappings.map((rule) => {
                  const internalProd = rule.internal_product?.name || '未知產品';
                  const internalVar = rule.internal_variant?.name || '';
                  const internalLabel = internalVar || internalProd;
                  const isEditing = editingId === rule.id;
                  const codeTargetCount = targetCountByCode.get(rule.vendor_product_id.trim()) || 1;

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
                  <TableCell className="text-center">
                    {rule.is_primary ? (
                      <Star
                        className="h-4 w-4 inline fill-amber-400 text-amber-500"
                        aria-label={`主對照${codeTargetCount > 1 ? `（此料號共 ${codeTargetCount} 個對應目標）` : ''}`}
                      />
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onSetPrimary(rule.id)}
                        disabled={isSettingPrimary}
                        title={codeTargetCount > 1
                          ? `設為主對照（此料號共 ${codeTargetCount} 個對應目標）`
                          : '設為主對照'}
                        aria-label={`設為主對照：${internalLabel}`}
                      >
                        <Star className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                  </TableCell>
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
                      rule.vendor_unit_cost != null ? formatCurrency(rule.vendor_unit_cost) : '-'
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
                          aria-label="儲存編輯"
                        >
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditingId(null)}
                          aria-label="取消編輯"
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
                          aria-label="編輯對照規則"
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
                          aria-label="刪除對照規則"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
              }))}
          </TableBody>
        </Table>
        </ScrollArea>
      </div>

      <MappingExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        mappings={mappings}
        supplierName={supplierName}
      />

      <MappingImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        supplierId={supplierId}
        supplierName={supplierName}
        onImportComplete={() => {
          // 批次寫入已失效 ['supplier-mappings'] 查詢，直接重整畫面會流失 SPA 狀態
        }}
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
                    const label = variantName || productName;
                    setAddValues(prev => ({ ...prev, internal_product_id: productId, internal_variant_id: variantId, internal_label: label }));
                  }}
                  onClose={() => {}}
                />
              )}
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="add-is-primary"
                checked={addValues.is_primary}
                onCheckedChange={(checked) => setAddValues(prev => ({ ...prev, is_primary: checked === true }))}
              />
              <div className="space-y-1">
                <Label htmlFor="add-is-primary" className="cursor-pointer">設為主對照</Label>
                <p className="text-xs text-muted-foreground">
                  同一廠商代號可對應多個內部產品／變體，採購匯入與成本查詢預設採用主對照；若此代號已有其他對照，本筆會自動以次要對照加入。
                </p>
              </div>
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
