import React, { useState } from 'react';
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
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  DimensionConfig,
  DimensionType,
  VariantFieldKey,
  VARIANT_FIELD_LABELS,
} from '@/types/order-grid';
import { cn } from '@/lib/utils';

interface DimensionItemData {
  id: string;
  value: string;
  label: string;
}

interface DimensionItemProps {
  item: DimensionItemData;
  onUpdate: (id: string, value: string, label: string) => void;
  onRemove: (id: string) => void;
  isCustom: boolean;
}

function DimensionItem({ item, onUpdate, onRemove, isCustom }: DimensionItemProps) {
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

interface OrderGridDimensionPickerProps {
  value: DimensionConfig;
  onChange: (config: DimensionConfig) => void;
  label: string;
}

export function OrderGridDimensionPicker({
  value,
  onChange,
  label,
}: OrderGridDimensionPickerProps) {
  const [items, setItems] = useState<DimensionItemData[]>(() => {
    if (value.type === 'custom' && value.values) {
      return value.values.map((v, i) => ({
        id: `dim_${i}_${v}`,
        value: v,
        label: v,
      }));
    }
    if (value.type === 'variant_field' && value.field) {
      return [
        {
          id: `field_${value.field}`,
          value: value.field,
          label: value.label || VARIANT_FIELD_LABELS[value.field],
        },
      ];
    }
    return [];
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i.id === active.id);
      const newIndex = prev.findIndex((i) => i.id === over.id);
      const next = arrayMove(prev, oldIndex, newIndex);
      if (value.type === 'custom') {
        onChange({ ...value, values: next.map((i) => i.value) });
      }
      return next;
    });
  };

  const handleTypeChange = (type: DimensionType) => {
    if (type === 'variant_field') {
      onChange({ type, label: value.label, field: 'option_1' });
      setItems([
        {
          id: 'field_option_1',
          value: 'option_1',
          label: VARIANT_FIELD_LABELS.option_1,
        },
      ]);
    } else if (type === 'custom') {
      onChange({ type, label: value.label, values: [] });
      setItems([]);
    } else {
      onChange({ type, label: value.label });
      setItems([]);
    }
  };

  const handleFieldChange = (field: VariantFieldKey) => {
    onChange({ ...value, field });
    setItems([
      {
        id: `field_${field}`,
        value: field,
        label: VARIANT_FIELD_LABELS[field],
      },
    ]);
  };

  const handleLabelChange = (label: string) => {
    onChange({ ...value, label });
  };

  const addItem = () => {
    const id = `dim_${Date.now()}`;
    setItems((prev) => [...prev, { id, value: '', label: '' }]);
  };

  const updateItem = (id: string, newValue: string, newLabel: string) => {
    setItems((prev) => {
      const next = prev.map((i) =>
        i.id === id ? { ...i, value: newValue, label: newLabel } : i
      );
      if (value.type === 'custom') {
        onChange({ ...value, values: next.map((i) => i.value) });
      }
      return next;
    });
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      if (value.type === 'custom') {
        onChange({ ...value, values: next.map((i) => i.value) });
      }
      return next;
    });
  };

  const isCustom = value.type === 'custom';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">{label}</Label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">維度類型</Label>
          <Select value={value.type} onValueChange={handleTypeChange}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="variant_field">Variant 欄位</SelectItem>
              <SelectItem value="product_list">產品列表</SelectItem>
              <SelectItem value="custom">自訂名稱</SelectItem>
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

      {value.type === 'variant_field' && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Variant 欄位</Label>
          <Select value={value.field || 'option_1'} onValueChange={handleFieldChange}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(VARIANT_FIELD_LABELS) as [VariantFieldKey, string][]).map(
                ([key, lbl]) => (
                  <SelectItem key={key} value={key}>
                    {lbl}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {(value.type === 'custom' || value.type === 'product_list') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              {value.type === 'custom' ? '自訂維度值' : '已選產品'}
            </Label>
            {isCustom && (
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
            )}
          </div>

          {isCustom && (
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
                      isCustom={isCustom}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {!isCustom && items.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              {value.type === 'product_list' && '將自動使用已選產品作為維度'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
