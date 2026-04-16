import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Pencil, Trash2, Plus, Download, Upload, Zap, Target, FileJson, FileSpreadsheet } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SpecDialog } from './SpecDialog';
import { useSpecData } from '../hooks/useSpecData';
import { SpecDefinition } from '../types';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
// 規格屬性庫面板 (v4.8 JSON 支援與視覺化管理)
export function SpecLibraryTab() {
    const queryClient = useQueryClient();
    const {
        specDefinitions,
        isLoadingSpecs,
        specMutation,
        handleSpecExport,
        handleSpecImport,
        handleSpecExportJSON,
        handleSpecImportJSON
    } = useSpecData();

    const [isSpecDialogOpen, setIsSpecDialogOpen] = useState(false);
    const [editingSpec, setEditingSpec] = useState<SpecDefinition | null>(null);
    const [specForm, setSpecForm] = useState<Partial<SpecDefinition>>({
        name: '',
        type: 'select',
        options: [''],
    });

    /**
     * v4.8 計算規格間的關係圖
     */
    const specRelations = useMemo(() => {
        const relations = new Map<string, { isSource: boolean; isTarget: boolean; parentNames: string[] }>();

        // 初始化
        specDefinitions.forEach(s => relations.set(s.id, { isSource: false, isTarget: false, parentNames: [] }));

        // 解析連動
        specDefinitions.forEach(s => {
            const triggers = s.logic_config?.triggers || [];
            if (triggers.length > 0) {
                const info = relations.get(s.id);
                if (info) info.isSource = true;

                triggers.forEach((t: any) => {
                    const targets = t.targets || t.target_ids?.map((id: string) => ({ id })) || [];
                    targets.forEach((tar: any) => {
                        const targetInfo = relations.get(tar.id);
                        if (targetInfo) {
                            targetInfo.isTarget = true;
                            if (!targetInfo.parentNames.includes(s.name)) {
                                targetInfo.parentNames.push(s.name);
                            }
                        }
                    });
                });
            }
        });

        return relations;
    }, [specDefinitions]);

    const openSpecDialog = (spec: SpecDefinition | null = null) => {
        if (spec) {
            setEditingSpec(spec);
            const migratedTriggers = (spec.logic_config?.triggers || []).map(t => ({
                ...t,
                targets: t.targets || (t as any).target_ids?.map((id: string) => ({ id, is_quantity_detail: false })) || []
            }));

            setSpecForm({
                ...spec,
                options: spec.options || [],
                logic_config: { ...spec.logic_config, triggers: migratedTriggers }
            });
        } else {
            setEditingSpec(null);
            setSpecForm({ name: '', type: 'select', options: [''], logic_config: { triggers: [] } });
        }
        setIsSpecDialogOpen(true);
    };

    const handleSubmit = () => {
        const cleaned = { ...specForm, options: (specForm.options || []).filter(o => o.trim() !== '') };
        specMutation.mutate({ spec: cleaned, editingSpecId: editingSpec?.id }, {
            onSuccess: () => setIsSpecDialogOpen(false),
        });
    };

    const handleDelete = async (spec: SpecDefinition) => {
        if (confirm(`確定要刪除規格「${spec.name}」嗎？這將導致所有關廠分類失去該欄位。`)) {
            const { error } = await (supabase.from('specification_definitions' as any) as any).delete().eq('id', spec.id);
            if (error) toast.error('刪除失敗');
            else queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
        }
    };

    return (
        <TooltipProvider>
            <div className="space-y-6">
                {/* 工具列 */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/20 p-4 rounded-xl border border-primary/5">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight">規格屬性庫 (v4.8)</h2>
                        <CardDescription>定義全站規格標準，支援進階連動邏輯與 JSON/CSV 資料交換。</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {/* JSON 工具 */}
                        <div className="flex items-center gap-1 bg-background rounded-lg p-1 border shadow-sm">
                            <Button variant="ghost" size="sm" onClick={handleSpecExportJSON} className="h-8 text-[11px] font-bold">
                                <FileJson className="h-3.5 w-3.5 mr-1.5 text-orange-500" /> 匯出 JSON
                            </Button>
                            <div className="w-[1px] h-4 bg-muted mx-0.5" />
                            <Label htmlFor="spec-import-json" className="cursor-pointer">
                                <Input id="spec-import-json" type="file" accept=".json" className="hidden" onChange={handleSpecImportJSON} />
                                <div className="inline-flex items-center px-2 py-1 h-8 text-[11px] font-bold hover:bg-muted rounded-md transition-colors">
                                    <Upload className="h-3.5 w-3.5 mr-1.5 text-orange-500" /> 匯入
                                </div>
                            </Label>
                        </div>

                        {/* CSV 工具 */}
                        <div className="flex items-center gap-1 bg-background rounded-lg p-1 border shadow-sm">
                            <Button variant="ghost" size="sm" onClick={handleSpecExport} className="h-8 text-[11px]">
                                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 text-green-600" /> 匯出 CSV
                            </Button>
                            <Label htmlFor="spec-import-csv" className="cursor-pointer">
                                <Input id="spec-import-csv" type="file" accept=".csv" className="hidden" onChange={handleSpecImport} />
                                <div className="inline-flex items-center px-2 py-1 h-8 text-[11px] hover:bg-muted rounded-md transition-colors">
                                    <Upload className="h-3.5 w-3.5 mr-1.5 text-green-600" /> 匯入
                                </div>
                            </Label>
                        </div>

                        <Button size="sm" onClick={() => openSpecDialog()} className="shadow-md">
                            <Plus className="mr-2 h-4 w-4" /> 新增規格
                        </Button>
                    </div>
                </div>

                {/* 規格卡片列表 */}
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {isLoadingSpecs ? (
                        <div className="col-span-full py-20 text-center animate-pulse text-muted-foreground">正在載入規格百科全書...</div>
                    ) : specDefinitions.map(spec => {
                        const rel = specRelations.get(spec.id);
                        return (
                            <Card key={spec.id} className="relative group overflow-hidden border-primary/10 hover:border-primary/40 hover:shadow-md transition-all duration-200">
                                <CardHeader className="pb-2 space-y-1">
                                    <div className="flex justify-between items-start gap-2">
                                        <CardTitle className="text-sm font-bold truncate leading-tight grow" title={spec.name}>
                                            {spec.name}
                                        </CardTitle>
                                        <Badge variant="outline" className="text-[9px] px-1.5 h-4 shrink-0 font-mono uppercase bg-muted/50">
                                            {spec.type}
                                        </Badge>
                                    </div>

                                    {/* 關係標籤列 */}
                                    <div className="flex flex-wrap gap-1 mt-1 empty:hidden">
                                        {rel?.isSource && (
                                            <Badge className="bg-orange-500/10 text-orange-600 border-orange-200 text-[9px] hover:bg-orange-500/20 px-1">
                                                <Zap className="h-2 w-2 mr-1 fill-current" /> 連動源
                                            </Badge>
                                        )}
                                        {rel?.isTarget && (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Badge className="bg-blue-500/10 text-blue-600 border-blue-200 text-[9px] hover:bg-blue-500/20 px-1">
                                                        <Target className="h-2 w-2 mr-1" /> 連動目標
                                                    </Badge>
                                                </TooltipTrigger>
                                                <TooltipContent className="text-[10px]">
                                                    受此規格控制: {rel.parentNames.join(', ')}
                                                </TooltipContent>
                                            </Tooltip>
                                        )}
                                    </div>

                                    <CardDescription className="text-[11px] line-clamp-2 min-h-[32px] pt-1 leading-normal">
                                        {spec.type === 'text' ? '自由文字輸入' :
                                            spec.type === 'boolean' ? '支援/不支援 (開關)' :
                                                spec.type === 'number_with_unit' ? `數值輸入 (單位: ${spec.options?.[0] || '無'})` :
                                                    spec.options.join(' / ')}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex justify-end gap-1.5 py-2 px-3 bg-muted/20 border-t mt-auto">
                                    <Button
                                        variant="ghost" size="icon" className="h-7 w-7 hover:bg-background shadow-sm"
                                        onClick={() => openSpecDialog(spec)}
                                    >
                                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>
                                    <Button
                                        variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                        onClick={() => handleDelete(spec)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>

                {/* 新增/編輯 Dialog */}
                <SpecDialog
                    open={isSpecDialogOpen}
                    onOpenChange={setIsSpecDialogOpen}
                    editingSpec={editingSpec}
                    specForm={specForm}
                    setSpecForm={setSpecForm}
                    onSubmit={handleSubmit}
                    isPending={specMutation.isPending}
                    allSpecs={specDefinitions}
                />
            </div>
        </TooltipProvider>
    );
}
