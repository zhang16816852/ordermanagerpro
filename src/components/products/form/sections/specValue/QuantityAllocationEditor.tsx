import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import type { SpecValueEditorProps } from './types';

/**
 * 數量配比編輯組件 (觸發總量連動與驗證)
 */
export function QuantityAllocationEditor({ spec, value, onChange, sourceValue, variantMode }: SpecValueEditorProps) {
    // 強化：確保 sourceValue 轉為字串再解析，避免 number 0 導致的 falsy 問題
    const targetTotal = parseInt(String(sourceValue || '0')) || 0;
    const currentValues = (typeof value === 'object' && value !== null && !Array.isArray(value)) ? value : {};
    const currentTotal = Object.values(currentValues).reduce((sum: number, val: any) => sum + (parseInt(String(val)) || 0), 0) as number;
    const isError = currentTotal !== targetTotal && targetTotal > 0;

    const toggleOption = (opt: string, checked: boolean) => {
        const next = { ...currentValues };
        if (checked) next[opt] = next[opt] || 1;
        else delete next[opt];
        onChange(next);
    };

    const handleQtyChange = (opt: string, val: string) => {
        const num = parseInt(val) || 0;
        onChange({ ...currentValues, [opt]: num });
    };

    const content = (
        <div className="space-y-3 p-1">
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                {spec.options.map((opt) => {
                    const isChecked = opt in currentValues;
                    return (
                        <div key={opt} className="flex items-center gap-2 group">
                            <Checkbox 
                                id={`qty-${spec.id}-${opt}`}
                                checked={isChecked}
                                onCheckedChange={(checked) => toggleOption(opt, !!checked)}
                            />
                            <label htmlFor={`qty-${spec.id}-${opt}`} className="text-xs flex-1 cursor-pointer truncate">{opt}</label>
                            {isChecked && (
                                <Input 
                                    type="number"
                                    min="1"
                                    className="h-7 w-16 text-[10px] text-right p-1"
                                    value={currentValues[opt] || ''}
                                    onChange={(e) => handleQtyChange(opt, e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="pt-2 border-t flex justify-between items-center text-[10px]">
                <span className="text-muted-foreground font-medium">總量需求: {targetTotal}</span>
                <span className={`font-bold ${isError ? 'text-destructive underline decoration-dotted' : 'text-primary'}`}>
                    已分配: {currentTotal} {isError && '⚠️'}
                </span>
            </div>
        </div>
    );

    if (variantMode) {
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <Button 
                        variant="outline" 
                        size="sm" 
                        type="button"
                        className={`h-8 px-2 text-[10px] w-full justify-between font-normal ${isError ? 'border-destructive text-destructive bg-destructive/5' : ''}`}
                    >
                        <span className="truncate">
                            {Object.entries(currentValues).map(([k, v]) => `${k}*${v}`).join('/') || '點擊分配'}
                        </span>
                        <Settings2 className="h-3 w-3 ml-1 opacity-50 shrink-0" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56" align="center">
                    <div className="text-xs font-bold mb-2 border-b pb-1">{spec.name} 數量分配</div>
                    {content}
                </PopoverContent>
            </Popover>
        );
    }

    return (
        <div className={`p-2 border rounded-md bg-background ${isError ? 'border-destructive/50 ring-1 ring-destructive/10 animate-pulse-subtle' : ''}`}>
            {content}
        </div>
    );
}