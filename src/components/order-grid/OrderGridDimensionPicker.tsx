import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GripVertical, Plus, Trash2, RotateCcw } from 'lucide-react';
import { useSpecStore } from '@/store/useSpecStore';
import {
  extractDimensionValues,
} from '@/lib/order-grid-utils';
import type {
  DimensionConfig,
  DimensionType,
  VariantFieldKey,
} from '@/types/order-grid';
import { VARIANT_FIELD_LABELS as FIELD_LABELS, DIMENSION_TYPE_LABELS } from '@/types/order-grid';
import type { ProductWithPricing } from '@/types/product';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Sub-component: DimensionItem (sortable custom value row)
// ---------------------------------------------------------------------------

interface DimensionItemData {
  id: string;
  value: string;
  label: string;
}

interface DimensionItemProps {
  item: DimensionItemData;
  onUpdate: (id: string, value: string, label: string) => void;
  onRemove: (id: string) => void;
}

function DimensionItem({ item, onUpdate, onRemove }: DimensionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 py-1.5 px-2 rounded-md border bg-background hover:bg-muted/50 transition-colors"
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/50" />
      </div>
      <div className="flex-1 grid grid-cols-2 gap-2">
        <Input
          value={item.value}
          onChange={(e) => onUpdate(item.id, e.target.value, item.label)}
          placeholder="維度值"
          className="h-8 text-sm"
        />
        <Input
          value={item.label}
          onChange={(e) => onUpdate(item.id, item.value, e.target.value)}
          placeholder="顯示名稱（選填）"
          className="h-8 text-sm"
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
        onClick={() => onRemove(item.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: ValueMapEditor
// ---------------------------------------------------------------------------

interface ValueMapEditorProps {
  rawValues: string[];
  valueMap?: Record<string, string>;
  onChange: (map: Record<string, string>) => void;
}

function ValueMapEditor({ rawValues, valueMap, onChange }: ValueMapEditorProps) {
  const handleRename = useCallback(
    (raw: string, display: string) => {
      const next = { ...valueMap };
      if (display) {
        next[raw] = display;
      } else {
        delete next[raw];
      }
      onChange(next);
    },
    [valueMap, onChange],
  );

  const handleReset = useCallback(() => {
    onChange({});
  }, [onChange]);

  if (rawValues.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">值顯示名稱 (選填)</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={handleReset}
        >
          <RotateCcw className="h-3 w-3" />
          重設為預設值
        </Button>
      </div>
      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {rawValues.map((raw) => (
          <div key={raw} className="flex items-center gap-2 py-0.5">
            <span className="text-xs text-muted-foreground flex-1 truncate" title={raw}>
              {raw}
            </span>
            <Input
              value={valueMap?.[raw] || ''}
              onChange={(e) => handleRename(raw, e.target.value)}
              placeholder={raw}
              className="h-7 text-sm flex-1"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component: OrderGridDimensionPicker
// ---------------------------------------------------------------------------

interface OrderGridDimensionPickerProps {
  value: DimensionConfig;
  onChange: (config: DimensionConfig) => void;
  label: string;
  /** Products used to extract available spec values for valueMap */
  products?: ProductWithPricing[];
}

export function OrderGridDimensionPicker({
  value,
  onChange,
  label,
  products,
}: OrderGridDimensionPickerProps) {
  const { specDefinitions } = useSpecStore();

  // Extract spec_ids that have values in selected products
  const usedSpecIds = useMemo(() => {
    if (!products || products.length === 0) return null; // null = no filter
    const ids = new Set<string>();
    products.forEach((p) => {
      p.variants?.forEach((v) => {
        const specVals = (v as any).spec_values;
        if (!specVals || typeof specVals !== 'object') return;
        Object.entries(specVals).forEach(([key, val]) => {
          if (!val) return;
          const parts = key.split(':');
          const specId = parts.length >= 2 ? parts[1] : key;
          ids.add(specId);
        });
      });
    });
    return ids;
  }, [products]);

  // Suitable specs: exclude heading/table, and if products provided, only show used specs
  const availableSpecs = useMemo(
    () =>
      specDefinitions.filter(
        (s: { id: string; type?: string }) =>
          s.type !== 'heading' && s.type !== 'table' &&
          (usedSpecIds === null || usedSpecIds.has(s.id)),
      ),
    [specDefinitions, usedSpecIds],
  );

  // Custom value items (for 'custom' type)
  const [items, setItems] = useState<DimensionItemData[]>(() => {
    if (value.type === 'custom' && value.values) {
      return value.values.map((v, i) => ({
        id: `dim_${i}_${v}`,
        value: v,
        label: v,
      }));
    }
    return [];
  });

  // Current dimension raw values (for valueMap editor)
  const dimensionValues = useMemo(() => {
    if (!products || products.length === 0) return [];
    return extractDimensionValues(value, products);
  }, [value, products]);

  // Ref to always have latest value (avoids stale closure in callbacks)
  const valueRef = useRef(value);
  valueRef.current = value;

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  // --- Handlers ---

  const handleTypeChange = useCallback(
    (type: DimensionType) => {
      const v = valueRef.current;
      if (type === 'variant_field') {
        onChange({ type, label: v.label, field: 'option_1' });
        setItems([]);
      } else if (type === 'spec') {
        onChange({ type, label: v.label, spec_id: undefined });
        setItems([]);
      } else if (type === 'custom') {
        onChange({ type, label: v.label, values: [] });
        setItems([]);
      } else {
        onChange({ type, label: v.label });
        setItems([]);
      }
    },
    [onChange],
  );

  const handleFieldChange = useCallback(
    (field: VariantFieldKey) => {
      onChange({ ...valueRef.current, field });
    },
    [onChange],
  );

  const handleSpecChange = useCallback(
    (specId: string) => {
      onChange({ ...valueRef.current, spec_id: specId });
    },
    [onChange],
  );

  const handleLabelChange = useCallback(
    (label: string) => {
      onChange({ ...valueRef.current, label });
    },
    [onChange],
  );

  const handleValueMapChange = useCallback(
    (map: Record<string, string>) => {
      onChange({ ...valueRef.current, valueMap: Object.keys(map).length > 0 ? map : undefined });
    },
    [onChange],
  );

  // Custom value handlers
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setItems((prev) => {
        const oldIndex = prev.findIndex((i) => i.id === active.id);
        const newIndex = prev.findIndex((i) => i.id === over.id);
        const next = arrayMove(prev, oldIndex, newIndex);
        onChange({ ...valueRef.current, values: next.map((i) => i.value) });
        return next;
      });
    },
    [onChange],
  );

  const addItem = useCallback(() => {
    const id = `dim_${Date.now()}`;
    setItems((prev) => [...prev, { id, value: '', label: '' }]);
  }, []);

  const updateItem = useCallback(
    (id: string, newValue: string, newLabel: string) => {
      setItems((prev) => {
        const next = prev.map((i) =>
          i.id === id ? { ...i, value: newValue, label: newLabel } : i,
        );
        onChange({ ...valueRef.current, values: next.map((i) => i.value) });
        return next;
      });
    },
    [onChange],
  );

  const removeItem = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((i) => i.id !== id);
        onChange({ ...valueRef.current, values: next.map((i) => i.value) });
        return next;
      });
    },
    [onChange],
  );

  // --- Render ---

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">{label}</Label>
      </div>

      {/* Type + Label */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">維度類型</Label>
          <Select value={value.type} onValueChange={handleTypeChange}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(DIMENSION_TYPE_LABELS) as [DimensionType, string][]).map(
                ([key, lbl]) => (
                  <SelectItem key={key} value={key}>
                    {lbl}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">顯示標題</Label>
          <Input
            value={value.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="例：容量、顏色"
            className="h-9"
          />
        </div>
      </div>

      {/* Variant field selector */}
      {value.type === 'variant_field' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Variant 欄位</Label>
          <Select
            value={value.field || 'option_1'}
            onValueChange={handleFieldChange}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(FIELD_LABELS) as [VariantFieldKey, string][]).map(
                ([key, lbl]) => (
                  <SelectItem key={key} value={key}>
                    {lbl}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Spec selector */}
      {value.type === 'spec' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">規格定義</Label>
          <Select
            value={value.spec_id || ''}
            onValueChange={handleSpecChange}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="選擇規格..." />
            </SelectTrigger>
            <SelectContent>
              {availableSpecs.map((spec: { id: string; name: string }) => (
                <SelectItem key={spec.id} value={spec.id}>
                  {spec.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Custom values editor */}
      {value.type === 'custom' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">自訂維度值</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={addItem}
            >
              <Plus className="h-3 w-3 mr-1" />
              新增
            </Button>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1.5">
                {items.map((item) => (
                  <DimensionItem
                    key={item.id}
                    item={item}
                    onUpdate={updateItem}
                    onRemove={removeItem}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Product list info */}
      {value.type === 'product_list' && (
        <p className="text-xs text-muted-foreground py-1">
          將自動使用已選產品作為維度
        </p>
      )}

      {/* ValueMap editor (shared across all types) */}
      {value.type !== 'product_list' && (
        <ValueMapEditor
          rawValues={dimensionValues}
          valueMap={value.valueMap}
          onChange={handleValueMapChange}
        />
      )}
    </div>
  );
}
