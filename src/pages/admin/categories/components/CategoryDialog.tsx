import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Check,
    Database,
    Link as LinkIcon,
    Settings2,
    X
} from 'lucide-react';
import { getStaticSpecTree } from '@/utils/specLogic';

import { CategorySpecLibraryTab } from './CategorySpecLibraryTab';
import { CategorySelectedConfigTab } from './CategorySelectedConfigTab';

interface CategoryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    name: string;
    setName: (name: string) => void;
    parentIds: string[];
    setParentIds: (ids: string[]) => void;
    activeConfiguration: any[]; // 已包含 id, isManual, sortOrder, sources
    engine: any; // 門面 API
    categories: any[];
    specDefinitions: any[];
    onSubmit: (e: React.FormEvent) => void;
}

const CategoryDialog = ({
    open,
    onOpenChange,
    name,
    setName,
    parentIds,
    setParentIds,
    activeConfiguration,
    engine,
    categories,
    specDefinitions,
    onSubmit,
}: CategoryDialogProps) => {
    const [activeTab, setActiveTab] = useState<'library' | 'config'>('library');
    console.log("已選規格", activeConfiguration)
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle>管理分類</DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* 基本資訊 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">分類名稱</Label>
                            <Input
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="例如：行動電源"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>上層分類 (可複選)</Label>
                            <div className="flex flex-wrap gap-2 p-2 border rounded-md min-h-[42px] bg-slate-50/50">
                                {categories
                                    .filter(c => parentIds.includes(c.id))
                                    .map(c => (
                                        <Badge key={c.id} variant="secondary" className="gap-1 pr-1">
                                            {c.name}
                                            <X
                                                className="h-3 w-3 cursor-pointer hover:text-destructive"
                                                onClick={() => setParentIds(parentIds.filter(id => id !== c.id))}
                                            />
                                        </Badge>
                                    ))}
                                {parentIds.length === 0 && <span className="text-sm text-muted-foreground">根分類</span>}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-2">
                                {categories
                                    .filter(c => !parentIds.includes(c.id))
                                    .slice(0, 10) // 限制顯示數量
                                    .map(c => (
                                        <Badge
                                            key={c.id}
                                            variant="outline"
                                            className="cursor-pointer hover:bg-slate-100"
                                            onClick={() => setParentIds([...parentIds, c.id])}
                                        >
                                            + {c.name}
                                        </Badge>
                                    ))}
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* 規格關聯區 */}
                    <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full">
                        <div className="flex items-center justify-between mb-4">
                            <TabsList>
                                <TabsTrigger value="library" className="gap-2">
                                    <Database className="h-4 w-4" />
                                    規格庫
                                </TabsTrigger>
                                <TabsTrigger value="config" className="gap-2 relative">
                                    <Settings2 className="h-4 w-4" />
                                    已選配置
                                    {activeConfiguration.length > 0 && (
                                        <Badge className="ml-1 px-1 min-w-[1.2rem] h-4 flex items-center justify-center text-[10px] bg-primary">
                                            {activeConfiguration.length}
                                        </Badge>
                                    )}
                                </TabsTrigger>
                            </TabsList>
                            <div className="text-xs text-muted-foreground flex items-center gap-4">
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 rounded-full bg-blue-500" /> 手動選取
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 rounded-full bg-slate-300" /> 連動產生
                                </div>
                            </div>
                        </div>

                        <TabsContent value="library" className="mt-0 border rounded-xl overflow-hidden bg-white shadow-sm">
                            <CategorySpecLibraryTab
                                specDefinitions={specDefinitions}
                                engine={engine}
                            />
                        </TabsContent>

                        <TabsContent value="config" className="mt-0 border rounded-xl bg-white shadow-inner overflow-hidden">
                            <CategorySelectedConfigTab
                                activeConfiguration={activeConfiguration}
                                specDefinitions={specDefinitions}
                                engine={engine}
                            />
                        </TabsContent>
                    </Tabs>
                </div>

                <div className="p-6 border-t bg-slate-50 flex justify-end gap-3">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                    <Button onClick={onSubmit}>儲存分類</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default CategoryDialog;
