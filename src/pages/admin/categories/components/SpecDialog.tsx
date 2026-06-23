import { useState, useMemo } from 'react';
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
import { X, Search } from 'lucide-react';
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
import { cn } from '@/lib/utils';

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
    const [targetSearch, setTargetSearch] = useState('');
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
    );

    const specLevels = useMemo(() => {
        const levels: Record<string, number> = {};
        const targetIds = new Set<string>();
        allSpecs.forEach(s => {
            (s.logic_config?.triggers || []).forEach((t: any) => {
                (t.targets || []).forEach((tar: any) => targetIds.add(tar.id));
            });
        });

        const getLevel = (id: string, visited = new Set<string>()): number => {
            if (visited.has(id)) return 0;
            visited.add(id);
            const parent = allSpecs.find(s =>
                (s.logic_config?.triggers || []).some((t: any) =>
                    (t.targets || []).some((tar: any) => tar.id === id)
                )
            );
            if (!parent) return 0;
            return 1 + getLevel(parent.id, visited);
        };

        allSpecs.forEach(s => {
            levels[s.id] = getLevel(s.id);
        });
        return levels;
    }, [allSpecs]);

    const updateTrigger = (index: number, field: string, value: any, targetId?: string) => {
        const triggers = [...(specForm.logic_config?.triggers || [])];
        const trigger = { ...triggers[index], operator: triggers[index].operator || 'eq' };

        if (field === 'target_toggle') {
            const targets = [...(trigger.targets || [])];
            const existingIdx = targets.findIndex(t => t.id === targetId);
            if (existingIdx >= 0) {
                targets.splice(existingIdx, 1);
            } else {
                targets.push({ id: targetId!, is_quantity_detail: false });
            }
            trigger.targets = targets;
        } else if (field === 'target_is_detail') {
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
                triggers: [...(prev.logic_config?.triggers || []), { on_value: '', targets: [], operator: 'eq' }]
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
            <DialogContent className="max-w-md max-h-[90vh] flex flex-col p-0" aria-describedby={undefined}>
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle>{editingSpec ? '編輯規格定義' : '新增規格定義'}</DialogTitle>
                    <DialogDescription>
                        請在此定義規格屬性的名稱、輸入型態以及連動觸發規則。
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-4">
                    {/* 基本資訊 */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">屬性名稱</label>
                            <Input
                                value={specForm.name}
                                onChange={(e) => setSpecForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="如：長度、容量"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">顯示排序</label>
                            <Input
                                type="number"
                                value={specForm.sort_order ?? 0}
                                onChange={(e) => setSpecForm(prev => ({ ...prev, sort_order: parseInt(e.target.value) || 0 }))}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">輸入型態</label>
                        <select
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                            value={specForm.type}
                            onChange={(e) => setSpecForm(prev => ({ ...prev, type: e.target.value as SpecDefinition['type'] }))}
                        >
                            <option value="heading">區段標題 (Heading)</option>
                            <option value="select">單選下拉 (Select)</option>
                            <option value="multiselect">多選 (Multi-select)</option>
                            <option value="text">文字輸入 (Text)</option>
                            <option value="boolean">是否支援 (Boolean)</option>
                            <option value="number_with_unit">數值輸入 (附單位)</option>
                            <option value="table">表格型規格 (Table)</option>
                        </select>
                    </div>

                    {/* 篩選器設定 */}
                    <div className="space-y-3 p-3 border rounded-md bg-purple-50/30">
                        <h4 className="text-sm font-bold text-purple-800">列表篩選器設定</h4>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="filter-enabled"
                                checked={specForm.configuration?.filter_config?.enabled ?? true}
                                onCheckedChange={(checked) => setSpecForm(prev => ({
                                    ...prev,
                                    configuration: { ...prev.configuration, filter_config: { ...(prev.configuration?.filter_config || { display_mode: 'auto' }), enabled: !!checked } }
                                }))}
                            />
                            <label htmlFor="filter-enabled" className="text-sm">允許作為篩選條件</label>
                        </div>
                    </div>

                    {/* 數量連動設定 (v6) */}
                    <div className="space-y-3 p-3 border rounded-md bg-blue-50/30 border-blue-100">
                        <h4 className="text-sm font-bold text-blue-800 border-b border-blue-100 pb-1">數量連動設定</h4>
                        <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground font-bold">根據此規格的數值產生對應數量的欄位</label>
                            <select
                                className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                value={(specForm as any).quantity_source_id || ''}
                                onChange={(e) => setSpecForm(prev => ({ ...prev, quantity_source_id: e.target.value || null }))}
                            >
                                <option value="">無連動 (預設)</option>
                                {allSpecs.filter(s => s.id !== editingSpec?.id && s.type !== 'heading').map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* 表格欄位定義 */}
                    {specForm.type === 'table' && (
                        <div className="space-y-3 p-3 border rounded-md bg-blue-50/20">
                            <div className="flex justify-between items-center">
                                <h4 className="text-sm font-bold">表格欄位定義</h4>
                                <Button size="sm" variant="outline" className="h-6" onClick={() => {
                                    const columns = [...(specForm.configuration?.columns || [])];
                                    columns.push({ id: Math.random().toString(36).substr(2, 9), name: '', type: 'text' });
                                    setSpecForm(prev => ({ ...prev, configuration: { ...prev.configuration, columns } }));
                                }}>+ 新增</Button>
                            </div>
                            {(specForm.configuration?.columns || []).map((col: any, idx: number) => (
                                <div key={col.id} className="p-2 border rounded bg-white relative space-y-2">
                                    <Input className="h-7 text-xs" value={col.name} onChange={(e) => {
                                        const columns = [...(specForm.configuration?.columns || [])];
                                        columns[idx] = { ...columns[idx], name: e.target.value };
                                        setSpecForm(prev => ({ ...prev, configuration: { ...prev.configuration, columns } }));
                                    }} placeholder="欄位名" />
                                    <select className="h-7 w-full text-xs border rounded" value={col.type} onChange={(e) => {
                                        const columns = [...(specForm.configuration?.columns || [])];
                                        columns[idx] = { ...columns[idx], type: e.target.value as any };
                                        setSpecForm(prev => ({ ...prev, configuration: { ...prev.configuration, columns } }));
                                    }}>
                                        <option value="text">文字</option>
                                        <option value="link">連結規格</option>
                                        <option value="select">單選</option>
                                    </select>
                                    {col.type === 'link' && (
                                        <select className="h-7 w-full text-xs border rounded bg-blue-50" value={col.linkedSpecId || ''} onChange={(e) => {
                                            const columns = [...(specForm.configuration?.columns || [])];
                                            columns[idx] = { ...columns[idx], linkedSpecId: e.target.value };
                                            setSpecForm(prev => ({ ...prev, configuration: { ...prev.configuration, columns } }));
                                        }}>
                                            <option value="">選擇規格...</option>
                                            {allSpecs.filter(s => s.id !== editingSpec?.id).map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* 連動規則設定 */}
                    <div className="space-y-3 p-3 border rounded-md bg-muted/20">
                        <div className="flex justify-between items-center">
                            <h4 className="text-sm font-bold">連動觸發設定 (Triggers)</h4>
                            <Button variant="ghost" size="sm" className="h-6" onClick={addTrigger}>+ 新增</Button>
                        </div>
                        {(specForm.logic_config?.triggers || []).map((trigger: any, idx: number) => (
                            <div key={idx} className="p-2 border rounded bg-background space-y-2 relative">
                                <Button variant="ghost" size="icon" className="h-5 w-5 absolute -top-1 -right-1" onClick={() => removeTrigger(idx)}><X className="h-3 w-3" /></Button>
                                <div className="flex gap-1">
                                    <select className="h-7 text-[10px] border rounded" value={trigger.operator || 'eq'} onChange={(e) => updateTrigger(idx, 'operator', e.target.value)}>
                                        <option value="eq">=</option>
                                        <option value="ne">≠</option>
                                    </select>
                                    <Input className="h-7 text-xs flex-1" value={trigger.on_value} onChange={(e) => updateTrigger(idx, 'on_value', e.target.value)} placeholder="觸發值 (如: true, *)" />
                                </div>
                                <div className="p-1 border rounded bg-slate-50 max-h-56 overflow-y-auto space-y-1">
                                    <div className="relative">
                                        <Search className="absolute left-2 top-2 h-3 w-3 text-slate-400" />
                                        <Input
                                            className="h-7 pl-6 text-[11px] mb-1"
                                            placeholder="搜尋規格..."
                                            value={targetSearch}
                                            onChange={(e) => setTargetSearch(e.target.value)}
                                        />
                                    </div>
                                    {allSpecs
                                        .filter(s => s.id !== editingSpec?.id && (!targetSearch || s.name.toLowerCase().includes(targetSearch.toLowerCase())))
                                        .map(s => {
                                        const targetObj = (trigger.targets || []).find((t: any) => t.id === s.id);
                                        const isChecked = !!targetObj;
                                        return (
                                            <div key={s.id} className={`flex items-center justify-between p-1 rounded ${isChecked ? 'bg-blue-50 border border-blue-100' : 'hover:bg-white'}`}>
                                                <div className="flex items-center gap-2">
                                                    <Checkbox checked={isChecked} onCheckedChange={() => updateTrigger(idx, 'target_toggle', null, s.id)} />
                                                    <span className={`text-[11px] ${isChecked ? 'font-bold text-blue-700' : ''}`}>{s.name}</span>
                                                </div>
                                                {isChecked && (
                                                    <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer hover:text-blue-600 bg-white px-1.5 py-0.5 rounded shadow-sm">
                                                        <input 
                                                            type="checkbox" 
                                                            className="rounded-sm"
                                                            checked={!!targetObj.is_quantity_detail} 
                                                            onChange={() => updateTrigger(idx, 'target_is_detail', null, s.id)} 
                                                        />
                                                        啟用數量分配器
                                                    </label>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 選項清單 */}
                    {(['select', 'multiselect', 'text', 'number_with_unit'].includes(specForm.type || '')) && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">選項/標籤定義</label>
                            {(specForm.options || []).map((opt: string, i: number) => (
                                <div key={i} className="flex gap-2">
                                    <Input className="h-8 text-sm" value={opt} onChange={(e) => {
                                        const newOpts = [...(specForm.options || [])];
                                        newOpts[i] = e.target.value;
                                        setSpecForm(prev => ({ ...prev, options: newOpts }));
                                    }} />
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSpecForm(prev => ({ ...prev, options: (prev.options || []).filter((_, idx) => idx !== i) }))}><X className="h-3 w-3" /></Button>
                                </div>
                            ))}
                            <Button variant="outline" size="sm" className="w-full" onClick={() => setSpecForm(prev => ({ ...prev, options: [...(prev.options || []), ''] }))}>+ 新增選項</Button>
                        </div>
                    )}
                </div>

                <DialogFooter className="p-4 border-t">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                    <Button onClick={onSubmit} disabled={isPending}>儲存規格</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
