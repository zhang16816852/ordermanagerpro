import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, RefreshCw, GripVertical, Star } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, arrayMove, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { useWarehouses, Warehouse } from '../hooks/useWarehouses';

interface WarehouseForm {
  name: string;
  code: string;
  type: string;
  include_in_actual: boolean;
  include_in_available: boolean;
}

const emptyForm: WarehouseForm = { name: '', code: '', type: '', include_in_actual: true, include_in_available: true };

function SortableWarehouseRow({
  warehouse,
  onEdit,
  onToggleActive,
}: {
  warehouse: Warehouse;
  onEdit: (wh: Warehouse) => void;
  onToggleActive: (wh: Warehouse) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: warehouse.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 py-2.5 px-3 border-b last:border-b-0 transition-colors',
        isDragging && 'opacity-50 shadow-lg bg-background rounded-lg border',
        !warehouse.is_active && 'opacity-50',
      )}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded shrink-0">
        <GripVertical className="h-4 w-4 text-muted-foreground/40" />
      </div>

      <div className="flex items-center gap-2 w-20 shrink-0">
        <Badge variant={warehouse.is_active ? 'default' : 'secondary'} className="text-[9px] h-4 px-1">
          {warehouse.is_active ? '啟用' : '停用'}
        </Badge>
        {warehouse.sort_order === 0 && (
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" {...{ title: "預設倉庫" } as any} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{warehouse.name}</span>
          {warehouse.sort_order === 0 && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-300 text-amber-600 shrink-0">
              預設
            </Badge>
          )}
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">{warehouse.code}</span>
      </div>

      <div className="text-xs text-muted-foreground w-20 truncate hidden sm:block">{warehouse.type || '-'}</div>

      <div className="flex items-center gap-3 text-xs w-28 shrink-0  md:flex">
        <span className={cn(warehouse.include_in_actual ? 'text-emerald-600' : 'text-muted-foreground')}>
          {warehouse.include_in_actual ? '✅ 實際' : '❌ 實際'}
        </span>
        <span className={cn(warehouse.include_in_available ? 'text-emerald-600' : 'text-muted-foreground')}>
          {warehouse.include_in_available ? '✅ 有效' : '❌ 有效'}
        </span>
      </div>

      <div className="flex gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(warehouse)} aria-label="編輯倉庫">
          <Pencil className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-[10px] px-1" onClick={() => onToggleActive(warehouse)}>
          {warehouse.is_active ? '停用' : '啟用'}
        </Button>
      </div>
    </div>
  );
}

export default function WarehousesTab() {
  const { warehouses, isLoading, createWarehouse, updateWarehouse, reorderWarehouses } = useWarehouses();
  const [localItems, setLocalItems] = useState<Warehouse[] | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WarehouseForm>(emptyForm);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const items = localItems ?? warehouses;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex(w => w.id === active.id);
    const newIndex = items.findIndex(w => w.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    setLocalItems(reordered);

    const updates = reordered.map((w, i) => ({ id: w.id, sort_order: i }));
    reorderWarehouses.mutate(updates, {
      onSuccess: () => setLocalItems(null),
      onError: () => setLocalItems(null),
    });
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowDialog(true);
  }

  function openEdit(wh: Warehouse) {
    setEditingId(wh.id);
    setForm({
      name: wh.name,
      code: wh.code,
      type: wh.type || '',
      include_in_actual: wh.include_in_actual,
      include_in_available: wh.include_in_available,
    });
    setShowDialog(true);
  }

  function handleSave() {
    if (!form.name.trim()) return;
    if (editingId) {
      const wh = warehouses.find(w => w.id === editingId);
      if (!wh) return;
      updateWarehouse.mutate({
        id: editingId,
        name: form.name.trim(),
        code: form.code.trim() || wh.code,
        type: form.type.trim() || null,
        include_in_actual: form.include_in_actual,
        include_in_available: form.include_in_available,
        is_active: wh.is_active,
      });
    } else {
      createWarehouse.mutate({
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        type: form.type.trim() || undefined,
        include_in_actual: form.include_in_actual,
        include_in_available: form.include_in_available,
      });
    }
    setShowDialog(false);
  }

  function toggleActive(wh: Warehouse) {
    updateWarehouse.mutate({
      id: wh.id,
      name: wh.name,
      code: wh.code,
      type: wh.type,
      include_in_actual: wh.include_in_actual,
      include_in_available: wh.include_in_available,
      is_active: !wh.is_active,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">拖曳排序，最上層為預設倉庫（⭐）</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RefreshCw className="mr-1 h-3 w-3" />
            重新整理
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-3 w-3" />
            新增倉庫
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        {isLoading ? (
          <div className="text-center text-xs text-muted-foreground py-10">載入中...</div>
        ) : items.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-10">暫無倉庫</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(w => w.id)} strategy={verticalListSortingStrategy}>
              {items.map(wh => (
                <SortableWarehouseRow
                  key={wh.id}
                  warehouse={wh}
                  onEdit={openEdit}
                  onToggleActive={toggleActive}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? '編輯倉庫' : '新增倉庫'}</DialogTitle>
            <DialogDescription>設定倉庫或通路的基本資訊與庫存計算規則</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">倉庫名稱 *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例：蝦皮倉、台北門市" className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">代碼</Label>
              <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="留空自動產生" className="text-sm font-mono" />
              {!form.code && form.name && (
                <p className="text-[10px] text-muted-foreground">自動產生：{form.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').slice(0, 4).toLowerCase()}_xxx</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">類型標籤</Label>
              <Input value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} placeholder="例：蝦皮、門市、寄賣" className="text-sm" />
            </div>
            <div className="flex gap-6 pt-2">
              <div className="flex items-center gap-2">
                <Checkbox id="incl-actual" checked={form.include_in_actual} onCheckedChange={v => setForm(f => ({ ...f, include_in_actual: !!v }))} />
                <Label htmlFor="incl-actual" className="text-sm cursor-pointer">算實際庫存</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="incl-avail" checked={form.include_in_available} onCheckedChange={v => setForm(f => ({ ...f, include_in_available: !!v }))} />
                <Label htmlFor="incl-avail" className="text-sm cursor-pointer">算有效庫存</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDialog(false)}>取消</Button>
            <Button size="sm" onClick={handleSave} disabled={!form.name.trim() || createWarehouse.isPending || updateWarehouse.isPending}>
              {editingId ? '儲存' : '新增'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
