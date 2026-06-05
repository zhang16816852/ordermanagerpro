import { Filter, Info } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImportRow } from './useProductImport';

interface PreviewToolbarProps {
    data: ImportRow[];
    filterStatus: string;
    onStatusFilterChange: (status: string) => void;
    filterCategory: string;
    onFilterChange: (id: string) => void;
}

export function PreviewToolbar({ data, filterStatus, onStatusFilterChange, filterCategory, onFilterChange }: PreviewToolbarProps) {
    const safeData = data || [];
    return (
        <div className="flex flex-wrap items-center gap-4 bg-muted/20 p-3 rounded-lg border">
            <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">變動篩選：</span>
                <Select value={filterStatus} onValueChange={onStatusFilterChange}>
                    <SelectTrigger className="w-[140px] h-8 bg-background">
                        <SelectValue placeholder="所有項目" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">顯示所有 ({safeData.length})</SelectItem>
                        <SelectItem value="changed">僅限變更項目</SelectItem>
                        <SelectItem value="new">僅限新增項目</SelectItem>
                        <SelectItem value="error">僅限錯誤項目</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="flex items-center gap-2 border-l pl-4 ml-2">
                <span className="text-sm font-medium text-muted-foreground">分類篩選：</span>
                <Select value={filterCategory} onValueChange={onFilterChange}>
                    <SelectTrigger className="w-[150px] h-8 bg-background">
                        <SelectValue placeholder="選擇分類" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">所有分類</SelectItem>
                        {Array.from(new Set(safeData.map(r => r.category).filter(Boolean))).map(catName => (
                            <SelectItem key={catName} value={catName}>{catName}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex-1 text-right text-[10px] text-muted-foreground">
                <Info className="h-3 w-3 inline mr-1 mb-0.5" />
                黃色背景代表內容與資料庫不符 (將被更新)
            </div>
        </div>
    );
}
