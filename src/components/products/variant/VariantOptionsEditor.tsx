import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { getContrastColor } from '@/utils/colorUtils';
import { Sparkles, Plus, X, GripVertical } from 'lucide-react';
import { ColorSelectField } from '@/components/products/form/ColorSelectField';
import { useColorStore } from '@/store/useColorStore';
import type { ProductColor } from '@/types/colors';
import {
  createOptionGroup,
  createOptionValue,
  isColorGroupName,
  findLibraryColor,
  type OptionGroupInput,
  type OptionGroupSuggestion,
} from '@/utils/variantGeneration';

interface VariantOptionsEditorProps {
  groups: OptionGroupInput[];
  onChange: (groups: OptionGroupInput[]) => void;
  suggestions?: OptionGroupSuggestion[];
  suggestionsLoading?: boolean;
  onImportSuggestion?: (sug: OptionGroupSuggestion) => void;
  onImportAllSuggestions?: () => void;
}

export function VariantOptionsEditor({
  groups,
  onChange,
  suggestions = [],
  suggestionsLoading = false,
  onImportSuggestion,
  onImportAllSuggestions,
}: VariantOptionsEditorProps) {
  const [bulkPasteTargetGroupId, setBulkPasteTargetGroupId] = useState<string | null>(null);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const { colors: libraryColors, fetchColors } = useColorStore();

  useEffect(() => {
    fetchColors();
  }, [fetchColors]);

  const updateGroupName = (groupId: string, name: string) => {
    onChange(groups.map(g => (g.id === groupId ? { ...g, name } : g)));
  };

  const removeGroup = (groupId: string) => {
    onChange(groups.filter(g => g.id !== groupId));
  };

  const addGroup = () => {
    onChange([...groups, createOptionGroup()]);
  };

  const updateValue = (groupId: string, valueId: string, field: string, value: string) => {
    onChange(
      groups.map(g =>
        g.id === groupId
          ? { ...g, values: g.values.map(v => (v.id === valueId ? { ...v, [field]: value } : v)) }
          : g,
      ),
    );
  };

  const removeValue = (groupId: string, valueId: string) => {
    onChange(
      groups.map(g =>
        g.id === groupId ? { ...g, values: g.values.filter(v => v.id !== valueId) } : g,
      ),
    );
  };

  const addValue = (groupId: string) => {
    onChange(
      groups.map(g =>
        g.id === groupId ? { ...g, values: [...g.values, createOptionValue()] } : g,
      ),
    );
  };

  const getGroupSelectedColorIds = (values: { id: string; label: string; value: string }[]): string[] => {
    const ids: string[] = [];
    for (const v of values) {
      const match = findLibraryColor(libraryColors, v);
      if (match && !ids.includes(match.id)) ids.push(match.id);
    }
    return ids;
  };

  const syncGroupColors = (groupId: string, colorIds: string[]) => {
    onChange(
      groups.map(g => {
        if (g.id !== groupId) return g;
        const nonLibrary = g.values.filter(v => !findLibraryColor(libraryColors, v));
        const existingByLabel = new Map<string, typeof g.values[number]>();
        for (const v of g.values) {
          if (v.label) existingByLabel.set(v.label.trim(), v);
        }
        const selectedValues = colorIds
          .map(id => libraryColors.find(c => c.id === id))
          .filter((c): c is ProductColor => !!c)
          .map(color => {
            const existing = existingByLabel.get(color.name.trim());
            return {
              id: existing?.id ?? `color-${color.id}`,
              label: color.name,
              value: color.code,
              wholesalePrice: existing?.wholesalePrice ?? '',
              retailPrice: existing?.retailPrice ?? '',
              hexCode: color.hex_code || '',
            };
          });
        return { ...g, values: [...nonLibrary, ...selectedValues] };
      }),
    );
  };

  const handleConfirmBulkPaste = () => {
    const rows = bulkPasteText
      .split(/[,，\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => {
        const parts = s.split(':');
        const label = parts[0].trim();
        if (parts.length === 3) {
          const value = parts[1].trim();
          const prices = parts[2].split(/[,，]/).map(p => p.trim());
          return createOptionValue(label, value, prices[0] || '', prices[1] || '');
        }
        if (parts.length === 2) {
          const prices = parts[1].split(/[,，]/).map(p => p.trim());
          return createOptionValue(label, '', prices[0] || '', prices[1] || '');
        }
        return createOptionValue(label);
      });

    if (bulkPasteTargetGroupId) {
      onChange(
        groups.map(g =>
          g.id === bulkPasteTargetGroupId ? { ...g, values: [...g.values, ...rows] } : g,
        ),
      );
    }

    setBulkPasteTargetGroupId(null);
    setBulkPasteText('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">選項群組</Label>
        <Button variant="outline" size="sm" onClick={addGroup}>
          <Plus className="h-4 w-4 mr-1" />新增群組
        </Button>
      </div>

      {!suggestionsLoading && suggestions.length > 0 && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-muted-foreground">
              分類建議（依此產品分類彙整自其他產品）
            </Label>
            {onImportAllSuggestions && (
              <Button variant="outline" size="sm" onClick={onImportAllSuggestions}>
                <Sparkles className="h-3.5 w-3.5 mr-1" />全部套用
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map(sug => {
              const applied = groups.some(
                g => g.name.trim().toLowerCase() === sug.name.toLowerCase(),
              );
              return (
                <div
                  key={sug.name}
                  className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-sm"
                >
                  <span className="font-medium shrink-0">{sug.name}</span>
                  <span className="text-muted-foreground text-xs truncate max-w-[200px]">
                    {sug.values.map(v => v.label).join('、')}
                  </span>
                  {applied ? (
                    <Badge variant="secondary" className="text-xs shrink-0">已套用</Badge>
                  ) : (
                    onImportSuggestion && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs shrink-0"
                        onClick={() => onImportSuggestion(sug)}
                      >
                        套用
                      </Button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {groups.length === 0 && (
        <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg">
          尚未建立任何選項群組，請點擊「新增群組」開始定義（例如：顏色、尺寸、規格...）
        </div>
      )}

      {groups.map(group => {
        const isColorGroup = isColorGroupName(group.name);
        const selectedColorIds = getGroupSelectedColorIds(group.values);
        const extraValues = group.values.filter(v => !findLibraryColor(libraryColors, v));

        return (
          <div key={group.id} className="border rounded-lg p-4 space-y-3 bg-card">
            <div className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                value={group.name}
                onChange={e => updateGroupName(group.id, e.target.value)}
                className="h-8 max-w-[200px] font-medium"
                placeholder="群組名稱（如：顏色、尺寸）"
              />
              {isColorGroup && (
                <Badge variant="outline" className="text-xs text-muted-foreground">顏色群組</Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-destructive ml-auto"
                onClick={() => removeGroup(group.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ColorSelectField
              selectedColorIds={selectedColorIds}
              onChange={(ids) => syncGroupColors(group.id, ids)}
            />

            {isColorGroup && extraValues.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {extraValues.map(v => (
                  <Badge
                    key={v.id}
                    variant="outline"
                    className="flex items-center gap-1 pr-1 pl-2 h-6"
                    style={{
                      backgroundColor: v.hexCode || 'transparent',
                      color: v.hexCode ? getContrastColor(v.hexCode) : 'inherit',
                    }}
                  >
                    {v.label || v.value}
                    <X
                      className="h-3 w-3 cursor-pointer hover:bg-black/10 rounded-full"
                      onClick={() => removeValue(group.id, v.id)}
                    />
                  </Badge>
                ))}
              </div>
            )}

            {!isColorGroup && (
              <OptionValueTable
                values={group.values}
                onUpdate={(id, field, value) => updateValue(group.id, id, field, value)}
                onRemove={(id) => removeValue(group.id, id)}
                onAdd={() => addValue(group.id)}
                onBulkPaste={() => {
                  setBulkPasteText('');
                  setBulkPasteTargetGroupId(group.id);
                }}
              />
            )}
          </div>
        );
      })}

      <Dialog
        open={bulkPasteTargetGroupId !== null}
        onOpenChange={(open) => { if (!open) setBulkPasteTargetGroupId(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>批量貼上</DialogTitle>
            <DialogDescription>
              每行或逗號分隔一個值。支援格式：<code>名稱</code>、<code>名稱:批發價,零售價</code> 或 <code>名稱:SKU值:批發價,零售價</code>
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={bulkPasteText}
            onChange={e => setBulkPasteText(e.target.value)}
            placeholder={'例如：\n霧面:M:800,1200\n透明:T:900,1300\n抗藍光'}
            className="min-h-[200px]"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBulkPasteTargetGroupId(null)}>取消</Button>
            <Button onClick={handleConfirmBulkPaste}>確認新增</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface OptionValueTableProps {
  values: { id: string; label: string; value: string; wholesalePrice: string; retailPrice: string; hexCode: string }[];
  onUpdate: (id: string, field: string, value: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onBulkPaste: () => void;
}

function OptionValueTable({ values, onUpdate, onRemove, onAdd, onBulkPaste }: OptionValueTableProps) {
  return (
    <div className="space-y-2">
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-2 py-1.5 text-left">名稱 (Label)</th>
              <th className="px-2 py-1.5 text-left w-[90px]">SKU 值</th>
              <th className="px-2 py-1.5 text-right w-[80px]">批發價</th>
              <th className="px-2 py-1.5 text-right w-[80px]">零售價</th>
              <th className="px-2 py-1.5 w-[60px]">色碼</th>
              <th className="px-2 py-1.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {values.length === 0 ? (
              <tr className="border-t">
                <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground text-sm">
                  尚無選項值，請按下方按鈕新增，或使用批量貼上
                </td>
              </tr>
            ) : values.map(v => (
              <tr key={v.id} className="border-t">
                <td className="px-2 py-1">
                  <Input
                    value={v.label}
                    onChange={e => onUpdate(v.id, 'label', e.target.value)}
                    className="h-8"
                    placeholder="顯示名稱"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={v.value}
                    onChange={e => onUpdate(v.id, 'value', e.target.value)}
                    className="h-8"
                    placeholder="留空=名稱"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    step="0.01"
                    value={v.wholesalePrice}
                    onChange={e => onUpdate(v.id, 'wholesalePrice', e.target.value)}
                    className="h-8 text-right"
                    placeholder="選填"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    step="0.01"
                    value={v.retailPrice}
                    onChange={e => onUpdate(v.id, 'retailPrice', e.target.value)}
                    className="h-8 text-right"
                    placeholder="選填"
                  />
                </td>
                <td className="px-2 py-1">
                  <div className="flex items-center gap-1">
                    <Input
                      value={v.hexCode}
                      onChange={e => onUpdate(v.id, 'hexCode', e.target.value)}
                      className="h-8 w-[36px] font-mono text-xs px-1"
                      placeholder="#"
                      maxLength={7}
                    />
                    {v.hexCode && /^#[0-9a-fA-F]{6}$/.test(v.hexCode) && (
                      <div
                        className="w-5 h-5 rounded border shrink-0"
                        style={{ backgroundColor: v.hexCode }}
                      />
                    )}
                  </div>
                </td>
                <td className="px-2 py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={() => onRemove(v.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onAdd}>
          + 新增項目
        </Button>
        <Button variant="outline" size="sm" onClick={onBulkPaste}>
          批量貼上
        </Button>
      </div>
    </div>
  );
}