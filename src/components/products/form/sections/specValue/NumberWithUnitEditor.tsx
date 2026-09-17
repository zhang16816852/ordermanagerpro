import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import { formatSpecValue } from '@/utils/specLogic';
import type { SpecValueEditorProps } from './types';

/**
 * 帶單位數值 (Number with Unit) - 支援多欄位
 */
export function NumberWithUnitEditor({ spec, value, onChange, sourceValue, variantMode }: SpecValueEditorProps) {
    const labels = spec.options || [];
    
    // 單一欄位模式 (傳統或只有一個單位)
    if (labels.length <= 1) {
        return (
            <div className="flex items-center space-x-2">
                <Input
                    type="number"
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={sourceValue ? `建議值: ${sourceValue}` : "請輸入"}
                    className="h-9"
                />
                {labels[0] && (
                    <span className="text-sm text-muted-foreground whitespace-nowrap">{labels[0]}</span>
                )}
            </div>
        );
    }

    // 多欄位模式
    const currentVals = (typeof value === 'object' && value !== null) ? value : {};
    
    const content = (
        <div className={`grid grid-cols-1 ${variantMode ? 'w-56 p-3' : 'sm:grid-cols-2 gap-2 mt-1'}`}>
            {labels.map((label) => {
                const unitMatch = label.match(/(.+?)\((.+?)\)/);
                const displayName = unitMatch ? unitMatch[1] : label;
                const unit = unitMatch ? unitMatch[2] : null;

                return (
                    <div key={label} className="flex items-center space-x-2 bg-muted/20 p-1.5 rounded-md border border-dashed border-muted-foreground/20 mb-2 last:mb-0">
                        <span className="text-[10px] font-bold text-muted-foreground min-w-[30px] truncate" title={displayName}>{displayName}</span>
                        <div className="relative flex-1">
                            <Input
                                type="number"
                                value={currentVals[label] || ''}
                                onChange={(e) => onChange({ ...currentVals, [label]: e.target.value })}
                                className="h-7 text-xs pr-8"
                            />
                            {unit && <span className="absolute right-2 top-1.5 text-[9px] text-muted-foreground/60">{unit}</span>}
                        </div>
                    </div>
                );
            })}
        </div>
    );

    if (variantMode) {
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" type="button" className="h-8 px-2 text-[10px] w-full justify-between font-normal">
                        <span className="truncate">{formatSpecValue(value, spec) || '未設定'}</span>
                        <Settings2 className="h-3 w-3 ml-1 opacity-50 shrink-0" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="center">
                    <div className="text-xs font-bold mb-3 border-b pb-1 flex items-center gap-2">
                        <Settings2 className="h-3.3 w-3" /> {spec.name} 詳細數值
                    </div>
                    {content}
                </PopoverContent>
            </Popover>
        );
    }

    return content;
}