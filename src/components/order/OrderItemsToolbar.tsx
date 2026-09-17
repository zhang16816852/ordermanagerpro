import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { LayoutList, Rows3, Grid3x3 } from 'lucide-react';
import type { ViewMode } from './orderItemsTypes';

interface OrderItemsToolbarProps {
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
    onEnterGrid: () => void;
    applicableTemplates: Array<{ id: string; name: string }>;
    selectedTemplateId: string;
    onTemplateChange: (id: string) => void;
}

export function OrderItemsToolbar({
    viewMode,
    onViewModeChange,
    onEnterGrid,
    applicableTemplates,
    selectedTemplateId,
    onTemplateChange,
}: OrderItemsToolbarProps) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <Button
                variant={viewMode === 'compact' ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onViewModeChange('compact')}
            >
                <LayoutList className="h-3.5 w-3.5 mr-1" />簡潔
            </Button>
            <Button
                variant={viewMode === 'detailed' ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onViewModeChange('detailed')}
            >
                <Rows3 className="h-3.5 w-3.5 mr-1" />詳細
            </Button>
            <Button
                variant={viewMode === 'grid' ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onEnterGrid}
                disabled={applicableTemplates.length === 0}
            >
                <Grid3x3 className="h-3.5 w-3.5 mr-1" />表格
            </Button>

            {/* Template 下拉菜单（仅网格模式显示） */}
            {viewMode === 'grid' && applicableTemplates.length > 0 && (
                <Select value={selectedTemplateId} onValueChange={onTemplateChange}>
                    <SelectTrigger className="w-[200px] h-7 text-xs">
                        <SelectValue placeholder="选择表格模板" />
                    </SelectTrigger>
                    <SelectContent>
                        {applicableTemplates.map(t => (
                            <SelectItem key={t.id} value={t.id} className="text-xs">
                                {t.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
            {viewMode === 'grid' && applicableTemplates.length === 0 && (
                <span className="text-xs text-muted-foreground">無適用表格模板</span>
            )}
        </div>
    );
}