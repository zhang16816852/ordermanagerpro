import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { FolderTree, ListPlus } from 'lucide-react';
import { Category, SpecDefinition } from '../types';

interface CategoryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingCategory: Category | null;
    // 表單狀態
    name: string;
    setName: (v: string) => void;
    parentIds: string[];
    setParentIds: React.Dispatch<React.SetStateAction<string[]>>;
    selectedSpecIds: string[];
    toggleSpecSelection: (id: string) => void;
    // 資料
    categories: Category[];
    specDefinitions: SpecDefinition[];
    // 提交
    onSubmit: () => void;
    isPending: boolean;
}

// 新增/編輯分類對話框
export function CategoryDialog({
    open,
    onOpenChange,
    editingCategory,
    name,
    setName,
    parentIds,
    setParentIds,
    selectedSpecIds,
    toggleSpecSelection,
    categories,
    specDefinitions,
    onSubmit,
    isPending,
}: CategoryDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{editingCategory ? '編輯分類' : '新增分類'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-6 py-4">
                    {/* 分類名稱 */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">分類名稱</label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="後台分類名稱"
                        />
                    </div>

                    {/* 父分類多選 */}
                    <div className="space-y-4">
                        <label className="text-sm font-medium flex items-center gap-2">
                            <FolderTree className="h-4 w-4" /> 父分類 (可多選)
                        </label>
                        <div className="grid grid-cols-2 gap-2 p-4 bg-muted/30 rounded-lg border border-dashed max-h-[200px] overflow-y-auto">
                            {categories
                                .filter(c => c.id !== editingCategory?.id)
                                .map(cat => (
                                    <div
                                        key={cat.id}
                                        className={`flex items-center gap-2 p-2 rounded border transition-colors cursor-pointer ${parentIds.includes(cat.id) ? 'bg-primary/5 border-primary/30' : 'hover:bg-muted'}`}
                                        onClick={() => setParentIds(prev =>
                                            prev.includes(cat.id)
                                                ? prev.filter(id => id !== cat.id)
                                                : [...prev, cat.id]
                                        )}
                                    >
                                        <Checkbox checked={parentIds.includes(cat.id)} onCheckedChange={() => { }} />
                                        <span className="text-sm truncate">{cat.name}</span>
                                    </div>
                                ))}
                        </div>
                    </div>

                    {/* 關聯規格屬性 */}
                    <div className="space-y-4">
                        <label className="text-sm font-medium flex items-center gap-2">
                            <ListPlus className="h-4 w-4" /> 關聯規格屬性
                        </label>
                        <div className="grid grid-cols-2 gap-3 p-4 bg-muted/30 rounded-lg border border-dashed">
                            {specDefinitions.length === 0 ? (
                                <div className="col-span-full py-4 text-center text-xs text-muted-foreground italic">
                                    尚未建立規格屬性，請先至「規格屬性庫」建立。
                                </div>
                            ) : specDefinitions.map(spec => (
                                <div
                                    key={spec.id}
                                    className={`flex items-center gap-2 p-2 rounded border transition-colors cursor-pointer ${selectedSpecIds.includes(spec.id) ? 'bg-primary/5 border-primary/30' : 'hover:bg-muted'}`}
                                    onClick={() => toggleSpecSelection(spec.id)}
                                >
                                    <Checkbox checked={selectedSpecIds.includes(spec.id)} onCheckedChange={() => { }} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{spec.name}</p>
                                        <p className="text-[10px] text-muted-foreground truncate">{spec.type}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                    <Button onClick={onSubmit} disabled={isPending}>儲存變更</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
