import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ModelPicker } from '@/components/repair/ModelPicker';
import { RepairPartLinksEditor } from '@/components/repair/RepairPartLinksEditor';
import { useDeviceModels } from '@/hooks/useDeviceModels';
import {
  useRepairParts,
  useRepairPartTags,
  useRepairPartMutations,
  useRepairPartTagMutations,
  RepairPart,
  RepairPartInput,
  RepairPartLinkInput,
} from '@/hooks/useRepairParts';
import { toast } from 'sonner';

interface RepairPartFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPart?: RepairPart | null;
  presetDeviceModelId?: string | null;
  onSaved?: (partId: string) => void;
  onCreateProduct?: (deviceModelId: string | null) => void;
}

const emptyForm = (deviceModelId?: string | null): RepairPartInput => ({
  device_model_id: deviceModelId || null,
  name: '',
  tags: [],
  description: null,
  supplier_id: null,
  default_unit_cost: 0,
  default_unit_price: 0,
  is_active: true,
  sort_order: 0,
  links: [],
});

export function RepairPartFormDialog({
  open,
  onOpenChange,
  editingPart,
  presetDeviceModelId,
  onSaved,
  onCreateProduct,
}: RepairPartFormDialogProps) {
  const { data: models } = useDeviceModels();
  const { tags: allTags } = useRepairPartTags();
  const { createMutation, updateMutation } = useRepairPartMutations();
  const { createTagMutation } = useRepairPartTagMutations();
  const { parts } = useRepairParts();

  const [form, setForm] = useState<RepairPartInput>(() => emptyForm(presetDeviceModelId));
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editingPart) {
      setForm({
        device_model_id: editingPart.device_model_id,
        name: editingPart.name,
        tags: editingPart.tags || [],
        description: editingPart.description,
        supplier_id: editingPart.supplier_id,
        default_unit_cost: editingPart.default_unit_cost,
        default_unit_price: editingPart.default_unit_price,
        is_active: editingPart.is_active,
        sort_order: editingPart.sort_order,
        links: editingPart.links.map(l => ({
          id: l.id,
          product_id: l.product_id,
          variant_id: l.variant_id,
          spec_label: l.spec_label,
          is_default: l.is_default,
        })),
      });
    } else {
      setForm(emptyForm(presetDeviceModelId));
    }
    setNewTag('');
  }, [open, editingPart, presetDeviceModelId]);

  const patch = (next: Partial<RepairPartInput>) => setForm(prev => ({ ...prev, ...next }));

  const toggleTag = (name: string) => {
    patch({ tags: form.tags.includes(name) ? form.tags.filter(t => t !== name) : [...form.tags, name] });
  };

  const handleAddTag = () => {
    const trimmed = newTag.trim();
    if (!trimmed) return;
    if (allTags.some(t => t.name === trimmed)) {
      toast.error(`標籤「${trimmed}」已存在`);
      return;
    }
    createTagMutation.mutate(trimmed, {
      onSuccess: () => {
        if (!form.tags.includes(trimmed)) patch({ tags: [...form.tags, trimmed] });
        setNewTag('');
      },
    });
  };

  const handleSubmit = () => {
    const name = form.name.trim();
    if (!name) {
      toast.error('請輸入零件名稱');
      return;
    }
    const filledLinks = form.links.filter(l => l.product_id);
    if (filledLinks.length !== form.links.length) {
      toast.error('有庫存商品連結尚未選擇商品');
      return;
    }
    // 恰有一筆預設連結（與 saveLinks 的規則一致）
    const firstDefault = filledLinks.findIndex(l => l.is_default);
    const withDefault = filledLinks.map((l, i) => ({
      ...l,
      is_default: firstDefault === -1 ? i === 0 : i === firstDefault,
    }));

    const payload: RepairPartInput = { ...form, name, links: withDefault };

    if (editingPart) {
      updateMutation.mutate(
        { id: editingPart.id, input: payload, keepIds: editingPart.links.map(l => l.id) },
        {
          onSuccess: () => {
            onOpenChange(false);
            onSaved?.(editingPart.id);
          },
        },
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: (id) => {
          onOpenChange(false);
          onSaved?.(id);
        },
      });
    }
  };

  const maxSortOrder = parts.reduce((max, p) => Math.max(max, p.sort_order), 0);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingPart ? '編輯維修零件' : '新增維修零件'}</DialogTitle>
          <DialogDescription>
            零件型錄記錄「適用型號 × 零件名稱」，並綁定實際具庫存的商品作為出貨依據。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>適用裝置型號</Label>
            <ModelPicker
              models={models}
              value={form.device_model_id}
              onChange={(id) => patch({ device_model_id: id })}
            />
            <p className="text-[11px] text-muted-foreground">
              留空代表通用零件（不限機型），將出現在所有機型的選單中。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="repair-part-name">零件名稱 <span className="text-destructive">*</span></Label>
            <Input
              id="repair-part-name"
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="例：手機背蓋、螢幕總成、換蓋板"
              className="h-9"
            />
            <p className="text-[11px] text-muted-foreground">同一型號下零件名稱不可重複。</p>
          </div>

          <div className="space-y-1.5">
            <Label>標籤</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {allTags.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.name)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    form.tags.includes(t.name)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                placeholder="新增標籤後按 Enter"
                className="h-8 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                disabled={!newTag.trim() || createTagMutation.isPending}
                onClick={handleAddTag}
              >
                新增
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="repair-part-desc">描述</Label>
            <Textarea
              id="repair-part-desc"
              value={form.description || ''}
              onChange={(e) => patch({ description: e.target.value || null })}
              placeholder="安裝注意事項、適用版本等選填說明"
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="repair-part-cost">預設成本</Label>
              <Input
                id="repair-part-cost"
                type="number"
                value={form.default_unit_cost}
                onChange={(e) => patch({ default_unit_cost: parseFloat(e.target.value) || 0 })}
                className="h-9 text-sm text-right"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repair-part-price">預設售價</Label>
              <Input
                id="repair-part-price"
                type="number"
                value={form.default_unit_price}
                onChange={(e) => patch({ default_unit_price: parseFloat(e.target.value) || 0 })}
                className="h-9 text-sm text-right"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repair-part-sort">排序</Label>
              <Input
                id="repair-part-sort"
                type="number"
                value={form.sort_order}
                onChange={(e) => patch({ sort_order: parseInt(e.target.value) || 0 })}
                className="h-9 text-sm text-right"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Label htmlFor="repair-part-active">啟用</Label>
              <p className="text-[11px] text-muted-foreground">停用後不會出現在維修單的零件選單中。</p>
            </div>
            <Switch
              id="repair-part-active"
              checked={form.is_active}
              onCheckedChange={(checked) => patch({ is_active: checked })}
            />
          </div>

          <RepairPartLinksEditor
            links={form.links as RepairPartLinkInput[]}
            onChange={(links) => patch({ links })}
          />

          {onCreateProduct && (
            <p className="text-[11px] text-muted-foreground">
              找不到對應的庫存商品？{' '}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => onCreateProduct(form.device_model_id)}
              >
                建立維修零件商品
              </button>
            </p>
          )}

          {!editingPart && form.sort_order === 0 && maxSortOrder > 0 && (
            <p className="text-[11px] text-muted-foreground">目前最大排序值為 {maxSortOrder}，留 0 將排在最前。</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? '儲存中...' : (editingPart ? '儲存變更' : '建立零件')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
