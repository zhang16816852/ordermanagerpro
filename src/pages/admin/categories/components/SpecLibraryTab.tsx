import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Pencil, Trash2, Plus, Download, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SpecDialog } from './SpecDialog';
import { useSpecData } from '../hooks/useSpecData';
import { SpecDefinition } from '../types';

// Badge 簡易元件
function InlineBadge({ children, variant = 'default', className = '' }: any) {
    const variants: any = {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'text-foreground border border-input',
    };
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${variants[variant]} ${className}`}>
            {children}
        </span>
    );
}

// 規格屬性庫 Tab（卡片列表 + 新增/匯出/匯入）
export function SpecLibraryTab() {
    const queryClient = useQueryClient();
    const { specDefinitions, isLoadingSpecs, specMutation, handleSpecExport, handleSpecImport } = useSpecData();
    console.log("規格屬性庫", specDefinitions);
    const [isSpecDialogOpen, setIsSpecDialogOpen] = useState(false);
    const [editingSpec, setEditingSpec] = useState<SpecDefinition | null>(null);
    const [specForm, setSpecForm] = useState<Partial<SpecDefinition>>({
        name: '',
        type: 'select',
        options: [''],
    });

    // 開啟 Dialog（新增或編輯）
    const openSpecDialog = (spec: SpecDefinition | null = null) => {
        if (spec) {
            setEditingSpec(spec);
            setSpecForm({ ...spec });
        } else {
            setEditingSpec(null);
            setSpecForm({ name: '', type: 'select', options: [''] });
        }
        setIsSpecDialogOpen(true);
    };

    // 提交表單
    const handleSubmit = () => {
        const cleaned = { ...specForm, options: (specForm.options || []).filter(o => o.trim() !== '') };
        specMutation.mutate({ spec: cleaned, editingSpecId: editingSpec?.id }, {
            onSuccess: () => setIsSpecDialogOpen(false),
        });
    };

    // 刪除規格
    const handleDelete = async (spec: SpecDefinition) => {
        if (confirm(`確定要刪除規格「${spec.name}」嗎？這將導致所有關聯分類失去該欄位。`)) {
            const { error } = await (supabase.from('specification_definitions' as any) as any).delete().eq('id', spec.id);
            if (error) {
                console.error('刪除規格失敗:', error);
            } else {
                queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
            }
        }
    };

    return (
        <>
            {/* 工具列 */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-semibold">規格屬性庫</h2>
                    <CardDescription>管理全站共用的產品規格屬性，定義後可供各分類連結使用。</CardDescription>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleSpecExport}>
                        <Download className="h-4 w-4 mr-2" />
                        匯出 CSV
                    </Button>
                    <Label htmlFor="spec-import" className="cursor-pointer">
                        <Input id="spec-import" type="file" accept=".csv" className="hidden" onChange={handleSpecImport} />
                        <Button variant="outline" size="sm" asChild>
                            <span>
                                <Upload className="h-4 w-4 mr-2" />
                                匯入 CSV
                            </span>
                        </Button>
                    </Label>
                    <Button size="sm" onClick={() => openSpecDialog()}>
                        <Plus className="mr-2 h-4 w-4" />
                        新增規格屬性
                    </Button>
                </div>
            </div>

            {/* 規格卡片列表 */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {isLoadingSpecs ? (
                    <div className="col-span-full py-12 text-center">正在抓取規格庫...</div>
                ) : specDefinitions.map(spec => (
                    <Card key={spec.id} className="relative group overflow-hidden border-primary/10 hover:border-primary/50 transition-colors">
                        <CardHeader className="pb-2">
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-base">{spec.name}</CardTitle>
                                <InlineBadge variant="outline" className="text-[10px]">{spec.type}</InlineBadge>
                            </div>
                            <CardDescription className="text-xs truncate">
                                {spec.type === 'text' ? '自定義文字輸入' :
                                    spec.type === 'boolean' ? '支援/不支援 (開關)' :
                                        spec.type === 'number_with_unit' ? `數值輸入 (單位: ${spec.options?.[0] || '無'})` :
                                            spec.options.join(' / ')}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex justify-end gap-2 py-2 bg-muted/30">
                            <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => openSpecDialog(spec)}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                onClick={() => handleDelete(spec)}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </CardContent>
                    </Card>
                ))}
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
            />
        </>
    );
}
