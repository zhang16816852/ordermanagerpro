import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
    allSpecs?: SpecDefinition[];
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
    allSpecs = []
}: SpecDialogProps) {
    // 拖拽感測器：移動超過 5px 才判定為拖拽，避免點擊被攔截
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
    );

    const updateTrigger = (index: number, field: string, value: any, targetId?: string) => {
        const triggers = [...(specForm.logic_config?.triggers || [])];
        const trigger = { ...triggers[index] };

        if (field === 'target_toggle') {
            // 切換目標規格的選取狀態
            const targets = [...(trigger.targets || [])];
            const existingIdx = targets.findIndex(t => t.id === targetId);
            if (existingIdx >= 0) {
                targets.splice(existingIdx, 1);
            } else {
                targets.push({ id: targetId!, is_quantity_detail: false });
            }
            trigger.targets = targets;
        } else if (field === 'target_is_detail') {
            // 切換某個目標是否為數量明細
            trigger.targets = trigger.targets?.map(t =>
                t.id === targetId ? { ...t, is_quantity_detail: !t.is_quantity_detail } : t
            );
        } else {
            (trigger as any)[field] = value;
        }

        triggers[index] = trigger;
        setSpecForm(prev => ({
            ...prev,
            logic_config: { ...prev.logic_config, triggers }
        }));
    };

    const addTrigger = () => {
        setSpecForm(prev => ({
            ...prev,
            logic_config: {
                ...prev.logic_config,
                triggers: [...(prev.logic_config?.triggers || []), { on_value: '', targets: [] }]
            }
        }));
    };

    const removeTrigger = (index: number) => {
        setSpecForm(prev => ({
            ...prev,
            logic_config: {
                ...prev.logic_config,
                triggers: (prev.logic_config?.triggers || []).filter((_, i) => i !== index)
            }
        }));
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md max-h-[90vh] flex flex-col p-0">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle>{editingSpec ? '編輯規格定義' : '新增規格定義'}</DialogTitle>
                    <DialogDescription>
                        請在此定義規格屬性的名稱、輸入型態以及連動觸發規則。定義後的規格可以用於產品分類與變體設定。
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
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

                    {/* 連動邏輯設定 (Triggers模式 V3) */}
                    <div className="space-y-3 p-3 border rounded-md bg-muted/20">
                        <div className="flex justify-between items-center border-b pb-1">
                            <h4 className="text-sm font-bold">連動觸發設定 (Triggers)</h4>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={addTrigger}>
                                + 新增規則
                            </Button>
                        </div>

                        {(specForm.logic_config?.triggers || []).length === 0 && (
                            <p className="text-[10px] text-muted-foreground italic text-center py-2">尚未設定觸發規則</p>
                        )}

                        <div className="space-y-4">
                            {(specForm.logic_config?.triggers || []).map((trigger, idx) => (
                                <div key={idx} className="space-y-2 p-2 border rounded bg-background relative group">
                                    <Button
                                        variant="ghost" size="icon"
                                        className="h-5 w-5 absolute -top-1 -right-1 hidden group-hover:flex"
                                        onClick={() => removeTrigger(idx)}
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>

                                    <div className="space-y-2">
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-muted-foreground uppercase font-bold">當值為...</label>
                                            {specForm.type === 'boolean' ? (
                                                <Select value={trigger.on_value || ''} onValueChange={(v) => updateTrigger(idx, 'on_value', v)}>
                                                    <SelectTrigger className="h-7 text-xs">
                                                        <SelectValue placeholder="選擇狀態" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="true">是 (true)</SelectItem>
                                                        <SelectItem value="false">否 (false)</SelectItem>
                                                        <SelectItem value="*">任何狀態 (*)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            ) : (specForm.type === 'select' || specForm.type === 'multiselect') ? (
                                                <Select value={trigger.on_value || ''} onValueChange={(v) => updateTrigger(idx, 'on_value', v)}>
                                                    <SelectTrigger className="h-7 text-xs">
                                                        <SelectValue placeholder="選擇選項" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="*">任何選項 (*)</SelectItem>
                                                        {specForm.options?.filter(o => o.trim() !== '').map(opt => (
                                                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <Input
                                                    placeholder="如: 1, 10 或 * (代表任何值)"
                                                    className="h-7 text-xs"
                                                    value={trigger.on_value || ''}
                                                    onChange={(e) => updateTrigger(idx, 'on_value', e.target.value)}
                                                />
                                            )}
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-muted-foreground uppercase font-bold">則顯示以下規格：</label>
                                            <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto p-1 border rounded bg-muted/10">
                                                {allSpecs.filter(s => s.id !== editingSpec?.id).map(s => {
                                                    const target = trigger.targets?.find(t => t.id === s.id);
                                                    const isChecked = !!target;
                                                    return (
                                                        <div key={s.id} className="flex items-center justify-between gap-2 p-1 hover:bg-muted/30 rounded">
                                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                                <Checkbox
                                                                    id={`trigger-${idx}-${s.id}`}
                                                                    checked={isChecked}
                                                                    onCheckedChange={() => updateTrigger(idx, 'target_toggle', null, s.id)}
                                                                />
                                                                <label htmlFor={`trigger-${idx}-${s.id}`} className="text-[11px] truncate cursor-pointer">{s.name}</label>
                                                            </div>
                                                            {isChecked && (
                                                                <div className="flex items-center gap-1 shrink-0">
                                                                    <Badge
                                                                        variant={target?.is_quantity_detail ? "default" : "outline"}
                                                                        className="cursor-pointer text-[8px] px-1 h-3.5"
                                                                        onClick={() => updateTrigger(idx, 'target_is_detail', null, s.id)}
                                                                    >
                                                                        {target?.is_quantity_detail ? "數量明細" : "普通顯示"}
                                                                    </Badge>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>


                    {/* 選項清單 / 標籤定義 (支援 Dnd 排序) */}
                    {(['select', 'multiselect', 'text', 'number_with_unit'].includes(specForm.type || '')) && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">
                                {(['text', 'number_with_unit'].includes(specForm.type || '')) ? '欄位標籤定義' : '選項清單'}
                            </label>
                            {(['text', 'number_with_unit'].includes(specForm.type || '')) && (
                                <p className="text-[10px] text-muted-foreground italic mb-2">
                                    提示：若希望輸入多個數值（如長寬高），請在此新增標籤。
                                    {specForm.type === 'number_with_unit' && ' 標籤可包含單位，如：長(cm)'}
                                </p>
                            )}
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
                                                {/* 判斷是否為「複合導向」的型態，若是則顯示 標籤+單位 雙軌輸入 */}
                                                {(specForm.type === 'text' || specForm.type === 'number_with_unit') ? (() => {
                                                    const match = opt.match(/(.+?)\((.+?)\)/);
                                                    const label = match ? match[1] : opt;
                                                    const unit = match ? match[2] : '';

                                                    const updateComposite = (newLabel: string, newUnit: string) => {
                                                        const newOpts = [...(specForm.options || [])];
                                                        newOpts[i] = newUnit.trim() ? `${newLabel.trim()}(${newUnit.trim()})` : newLabel.trim();
                                                        setSpecForm(prev => ({ ...prev, options: newOpts }));
                                                    };

                                                    return (
                                                        <div className="flex-1 flex gap-2">
                                                            <Input
                                                                placeholder="標籤 (如: 長)"
                                                                className="flex-[2] h-8 text-xs"
                                                                value={label}
                                                                onChange={(e) => updateComposite(e.target.value, unit)}
                                                            />
                                                            <Input
                                                                placeholder="單位 (選填)"
                                                                className="flex-1 h-8 text-xs"
                                                                value={unit}
                                                                onChange={(e) => updateComposite(label, e.target.value)}
                                                            />
                                                        </div>
                                                    );
                                                })() : (
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
                                                                    if (i === options.length - 1 && currentValue.trim() !== '') {
                                                                        options.push('');
                                                                        setTimeout(() => {
                                                                            const next = document.querySelector<HTMLInputElement>(
                                                                                `input[name="spec-option-${options.length - 1}"]`
                                                                            );
                                                                            next?.focus();
                                                                        }, 0);
                                                                    }
                                                                    return { ...prev, options };
                                                                });
                                                            }
                                                        }}
                                                    />
                                                )}
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
