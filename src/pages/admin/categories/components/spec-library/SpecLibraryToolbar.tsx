import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CardDescription } from '@/components/ui/card';
import { Plus, Upload, FileJson, FileSpreadsheet, LayoutGrid, Network } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ToolbarProps {
    viewMode: 'grid' | 'tree';
    onViewModeChange: (mode: 'grid' | 'tree') => void;
    onAdd: () => void;
    onExportJSON: () => void;
    onImportJSON: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onExportCSV: () => void;
    onImportCSV: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function Toolbar({
    viewMode,
    onViewModeChange,
    onAdd,
    onExportJSON,
    onImportJSON,
    onExportCSV,
    onImportCSV
}: ToolbarProps) {
    return (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/20 p-4 rounded-xl border border-primary/5">
            <div className="space-y-1">
                <h2 className="text-xl font-bold tracking-tight">規格屬性庫 (v4.10)</h2>
                <CardDescription>定義全站規格標準，管理深度連動邏輯。</CardDescription>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
                {/* 視圖切換 */}
                <Tabs value={viewMode} onValueChange={(v: any) => onViewModeChange(v)} className="bg-background border rounded-lg p-0.5 shadow-sm">
                    <TabsList className="h-8 p-0 bg-transparent">
                        <TabsTrigger value="grid" className="h-7 px-3 text-[11px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                            <LayoutGrid className="h-3.5 w-3.5 mr-1.5" /> 網格清單
                        </TabsTrigger>
                        <TabsTrigger value="tree" className="h-7 px-3 text-[11px] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                            <Network className="h-3.5 w-3.5 mr-1.5" /> 邏輯樹狀
                        </TabsTrigger>
                    </TabsList>
                </Tabs>

                <div className="flex flex-wrap gap-2">
                    {/* JSON 工具 */}
                    <div className="flex items-center gap-1 bg-background rounded-lg p-1 border shadow-sm">
                        <Button variant="ghost" size="sm" onClick={onExportJSON} className="h-8 text-[11px] font-bold">
                            <FileJson className="h-3.5 w-3.5 mr-1.5 text-orange-500" /> 匯出 JSON
                        </Button>
                        <Label htmlFor="spec-import-json" className="cursor-pointer">
                            <Input id="spec-import-json" type="file" accept=".json" className="hidden" onChange={onImportJSON} />
                            <div className="inline-flex items-center px-2 py-1 h-8 text-[11px] font-bold hover:bg-muted rounded-md transition-colors">
                                <Upload className="h-3.5 w-3.5 mr-1.5 text-orange-500" /> 匯入
                            </div>
                        </Label>
                    </div>

                    {/* CSV 工具 */}
                    <div className="flex items-center gap-1 bg-background rounded-lg p-1 border shadow-sm">
                        <Button variant="ghost" size="sm" onClick={onExportCSV} className="h-8 text-[11px]">
                            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 text-green-600" /> 匯出 CSV
                        </Button>
                        <Label htmlFor="spec-import-csv" className="cursor-pointer">
                            <Input id="spec-import-csv" type="file" accept=".csv" className="hidden" onChange={onImportCSV} />
                            <div className="inline-flex items-center px-2 py-1 h-8 text-[11px] hover:bg-muted rounded-md transition-colors">
                                <Upload className="h-3.5 w-3.5 mr-1.5 text-green-600" /> 匯入
                            </div>
                        </Label>
                    </div>

                    <Button size="sm" onClick={onAdd} className="shadow-md">
                        <Plus className="mr-2 h-4 w-4" /> 新增規格
                    </Button>
                </div>
            </div>
        </div>
    );
}
