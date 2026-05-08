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

    const handleToggle = (id: string) => {
        engine.toggle(id);
    };

    const handleSortOrderChange = (id: string, order: number) => {
        engine.setSortOrder(id, order);
    };

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

                        <TabsContent value="library" className="mt-0 border rounded-xl overflow-hidden bg-slate-50/30">
                            <div className="flex flex-col gap-1 p-4 max-h-[400px] overflow-y-auto">
                                {getStaticSpecTree(specDefinitions).map(({ spec, level }) => {
                                    const isSelected = engine.isSelected(spec.id);
                                    const isManual = engine.isManual(spec.id);

                                    return (
                                        <div
                                            key={spec.id}
                                            onClick={() => handleToggle(spec.id)}
                                            style={{ marginLeft: `${level * 20}px` }}
                                            className={`
                                                flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all
                                                ${isSelected
                                                    ? (isManual ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-100' : 'bg-slate-100 border-slate-200 opacity-80')
                                                    : 'bg-white hover:border-slate-300 hover:shadow-sm'
                                                }
                                            `}
                                        >
                                            <div className="flex items-center gap-3">
                                                {level > 0 && <LinkIcon className="h-3 w-3 text-slate-300" />}
                                                <div className="flex flex-col">
                                                    <span className={`text-sm font-medium ${isSelected && isManual ? 'text-blue-700' : 'text-slate-700'}`}>
                                                        {spec.name}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">{spec.type}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {isSelected && (
                                                    isManual ? <Check className="h-4 w-4 text-blue-600" /> : <LinkIcon className="h-3 w-3 text-slate-400 animate-pulse" />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                {specDefinitions.length === 0 && (
                                    <div className="p-12 text-center text-muted-foreground italic">
                                        尚未建立任何規格定義
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        <TabsContent value="config" className="mt-0 border rounded-xl bg-white shadow-inner">
                            <div className="max-h-[400px] overflow-y-auto">
                                {activeConfiguration.length === 0 ? (
                                    <div className="p-12 text-center text-muted-foreground space-y-2">
                                        <Settings2 className="h-12 w-12 mx-auto opacity-20" />
                                        <p>尚未選擇任何規格</p>
                                    </div>
                                ) : (
                                    <div className="divide-y">
                                        {activeConfiguration.map((config, index) => {
                                            const spec = specDefinitions.find(s => s.id === config.id);
                                            if (!spec) return null;

                                            return (
                                                <div key={config.id} className="flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors group">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className="text-[10px] font-mono text-slate-400">#{index + 1}</span>
                                                        <div className="flex flex-col gap-0.5">
                                                            <Input
                                                                type="number"
                                                                className="h-7 w-14 text-center text-xs p-1"
                                                                value={config.sortOrder}
                                                                onChange={(e) => handleSortOrderChange(config.id, parseInt(e.target.value) || 0)}
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="font-semibold text-slate-900 truncate">{spec.name}</h4>
                                                            {config.isManual ? (
                                                                <Badge variant="outline" className="text-[10px] h-4 px-1 border-blue-200 text-blue-600 bg-blue-50">MANUAL</Badge>
                                                            ) : (
                                                                <Badge variant="outline" className="text-[10px] h-4 px-1">PASSIVE</Badge>
                                                            )}
                                                        </div>
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {config.sources.map((src: any, i: number) => {
                                                                if (src.type === 'manual') return null;
                                                                const parentSpec = specDefinitions.find(s => s.id === src.id);
                                                                return (
                                                                    <span key={i} className="inline-flex items-center text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                                        <LinkIcon className="h-2 w-2 mr-1" />
                                                                        {parentSpec?.name || 'Unknown'}
                                                                    </span>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-slate-400 hover:text-destructive"
                                                            onClick={() => handleToggle(config.id)}
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
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
