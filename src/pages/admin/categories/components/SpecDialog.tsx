import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { X } from 'lucide-react';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { SortableItem } from '../../SortableItem';
import { SpecDefinition } from '../types';

interface SpecDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingSpec: SpecDefinition | null;
    specForm: Partial<SpecDefinition>;
    setSpecForm: React.Dispatch<React.SetStateAction<Partial<SpecDefinition>>>;
    onSubmit: () => void;
    isPending: boolean;
}

// 新增/編輯規格屬性對話框（含選項拖拽排序）
export function SpecDialog({
    open,
    onOpenChange,
    editingSpec,
    specForm,
    setSpecForm,
    onSubmit,
    isPending,
}: SpecDialogProps) {
    // 拖拽感測器：移動超過 5px 才判定為拖拽，避免點擊被攔截
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{editingSpec ? '編輯規格定義' : '新增規格定義'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    {/* 屬性名稱 */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">屬性名稱</label>
                        <Input
                            value={specForm.name}
                            onChange={(e) => setSpecForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="如：長度、容量、顏色"
                        />
                    </div>

                    {/* 輸入型態 */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">輸入型態</label>
                        <select
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            value={specForm.type}
                            onChange={(e) => setSpecForm(prev => ({ ...prev, type: e.target.value as any }))}
                        >
                            <option value="select">單選下拉 (Select)</option>
                            <option value="multiselect">多選 (Multi-select)</option>
                            <option value="text">文字輸入 (Text)</option>
                            <option value="boolean">是否支援 (Boolean開關)</option>
                            <option value="number_with_unit">數值輸入 (附帶單位)</option>
                        </select>
                    </div>

                    {/* select / multiselect：可拖拽排序的選項清單 */}
                    {(specForm.type === 'select' || specForm.type === 'multiselect') && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">選項清單</label>
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={(event) => {
                                    const { active, over } = event;
                                    if (!over || active.id === over.id) return;
                                    setSpecForm(prev => ({
                                        ...prev,
                                        options: arrayMove(prev.options || [], Number(active.id), Number(over.id))
                                    }));
                                }}
                            >
                                <SortableContext
                                    items={(specForm.options || []).map((_, i) => i.toString())}
                                    strategy={verticalListSortingStrategy}
                                >
                                    {(specForm.options || []).map((opt, i) => (
                                        <SortableItem key={i} id={i.toString()}>
                                            <div className="flex gap-2 items-center">
                                                <Input
                                                    name={`spec-option-${i}`}
                                                    className="flex-1 h-8 text-sm"
                                                    value={opt}
                                                    onChange={(e) => {
                                                        const newOpts = [...(specForm.options || [])];
                                                        newOpts[i] = e.target.value;
                                                        setSpecForm(prev => ({ ...prev, options: newOpts }));
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === 'Tab') {
                                                            e.preventDefault();
                                                            setSpecForm(prev => {
                                                                const currentValue = prev.options?.[i] || '';
                                                                const options = [...(prev.options || [])];
                                                                // 最後一個且非空 → 新增一行
                                                                if (i === options.length - 1 && currentValue.trim() !== '') {
                                                                    options.push('');
                                                                    setTimeout(() => {
                                                                        const next = document.querySelector<HTMLInputElement>(
                                                                            `input[name="spec-option-${options.length - 1}"]`
                                                                        );
                                                                        next?.focus();
                                                                    }, 0);
                                                                } else {
                                                                    // 移至下一個空白輸入
                                                                    const firstEmptyIndex = options.findIndex(o => o.trim() === '');
                                                                    if (firstEmptyIndex >= 0) {
                                                                        setTimeout(() => {
                                                                            const next = document.querySelector<HTMLInputElement>(
                                                                                `input[name="spec-option-${firstEmptyIndex}"]`
                                                                            );
                                                                            next?.focus();
                                                                        }, 0);
                                                                    }
                                                                }
                                                                return { ...prev, options };
                                                            });
                                                        }
                                                    }}
                                                />
                                                <Button
                                                    variant="ghost" size="icon" className="h-8 w-8"
                                                    onClick={() => {
                                                        setSpecForm(prev => ({
                                                            ...prev,
                                                            options: (prev.options || []).filter((_, idx) => idx !== i)
                                                        }));
                                                    }}
                                                >
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </SortableItem>
                                    ))}
                                </SortableContext>
                            </DndContext>
                            <Button
                                variant="outline" size="sm" className="w-full mt-1"
                                onClick={() => setSpecForm(prev => ({ ...prev, options: [...(prev.options || []), ''] }))}
                            >
                                + 新增選項
                            </Button>
                        </div>
                    )}

                    {/* text：預設文字值 */}
                    {specForm.type === 'text' && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">預設文字值</label>
                            <Input
                                value={specForm.options?.[0] || ''}
                                onChange={(e) => setSpecForm(prev => ({ ...prev, options: [e.target.value] }))}
                                placeholder="請輸入預設文字"
                            />
                        </div>
                    )}

                    {/* number_with_unit：數值單位 */}
                    {specForm.type === 'number_with_unit' && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">數值單位 (例如: W, mAh, cm, kg)</label>
                            <Input
                                value={specForm.options?.[0] || ''}
                                onChange={(e) => setSpecForm(prev => ({ ...prev, options: [e.target.value] }))}
                                placeholder="請輸入單位名稱"
                            />
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                    <Button
                        onClick={onSubmit}
                        disabled={isPending}
                    >
                        儲存規格
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
