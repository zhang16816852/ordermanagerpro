import React from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import { CategorySpec } from '@/hooks/useCategorySpecs';

interface SpecValueEditorProps {
    spec: CategorySpec;
    value: any;
    onChange: (val: any) => void;
    sourceValue?: any; 
    variantMode?: boolean; 
}

/**
 * v4.7 物件化編輯器註冊表 (Registry)
 * 每個屬性對應一個處理特定 spec.type 的子組件
 */
const SpecRenderers: Record<string, React.FC<SpecValueEditorProps>> = {
    // 1. 布林開關 (Boolean)
    boolean: ({ spec, value, onChange }) => {
        const isTrue = value === 'true' || value === true;
        return (
            <div className="flex items-center space-x-2 h-9 border rounded-md px-3 bg-background group-hover:border-primary/30 transition-colors">
                <Checkbox
                    id={`spec-editor-${spec.id}`}
                    checked={isTrue}
                    onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
                />
                <label htmlFor={`spec-editor-${spec.id}`} className="text-sm cursor-pointer select-none flex-1">
                    支援
                </label>
            </div>
        );
    },

    // 2. 帶單位數字 (Number with Unit)
    number_with_unit: ({ spec, value, onChange, sourceValue }) => (
        <div className="flex items-center space-x-2">
            <Input
                type="number"
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                placeholder={sourceValue ? `建議值: ${sourceValue}` : "數值"}
                className="h-9"
            />
            {spec.options?.[0] && (
                <span className="text-sm text-muted-foreground whitespace-nowrap">{spec.options[0]}</span>
            )}
        </div>
    ),

    // 3. 多選列表 (MultiSelect)
    multiselect: ({ spec, value, onChange }) => {
        const currentVals = Array.isArray(value) 
            ? value 
            : (typeof value === 'string' && value ? value.split(',') : []);
            
        return (
            <div className="flex flex-col gap-1.5 p-2 border rounded-md bg-background max-h-32 overflow-y-auto shadow-inner">
                {spec.options?.map((opt) => (
                    <div key={opt} className="flex items-center gap-2 hover:bg-muted/30 p-1 rounded transition-colors">
                        <Checkbox
                            id={`multi-${spec.id}-${opt}`}
                            checked={currentVals.includes(opt)}
                            onCheckedChange={(checked) => {
                                const next = checked ? [...currentVals, opt] : currentVals.filter((v: any) => v !== opt);
                                onChange(next);
                            }}
                        />
                        <label htmlFor={`multi-${spec.id}-${opt}`} className="text-sm cursor-pointer flex-1">{opt}</label>
                    </div>
                ))}
            </div>
        );
    },

    // 4. 下拉單選 (Select)
    select: ({ spec, value, onChange }) => (
        <Select value={value || ''} onValueChange={onChange}>
            <SelectTrigger className="h-9">
                <SelectValue placeholder="請選擇" />
            </SelectTrigger>
            <SelectContent>
                {spec.options.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    ),

    // 5. 預設輸入框 (Default)
    default: ({ spec, value, onChange, sourceValue }) => (
        <Input
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={sourceValue ? `來自父級: ${sourceValue}` : `輸入${spec.name}`}
            className="h-9"
        />
    )
};

/**
 * 數量明細分配組件 (單獨抽離以維持整潔)
 */
function QuantityAllocationEditor({ spec, value, onChange, sourceValue, variantMode }: SpecValueEditorProps) {
    const targetTotal = parseInt(sourceValue) || 0;
    const currentValues = (typeof value === 'object' && value !== null && !Array.isArray(value)) ? value : {};
    const currentTotal = Object.values(currentValues).reduce((sum: number, val: any) => sum + (parseInt(val) || 0), 0) as number;
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
                <span className="text-muted-foreground font-medium">目標: {targetTotal}</span>
                <span className={`font-bold ${isError ? 'text-destructive underline decoration-dotted' : 'text-primary'}`}>
                    已分: {currentTotal} {isError && '⚠️'}
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
                        className={`h-8 px-2 text-[10px] w-full justify-between font-normal ${isError ? 'border-destructive text-destructive bg-destructive/5' : ''}`}
                    >
                        <span className="truncate">
                            {Object.entries(currentValues).map(([k, v]) => `${k}*${v}`).join('/') || '未分配'}
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

/**
 * 主組件：SpecValueEditor
 */
export function SpecValueEditor(props: SpecValueEditorProps) {
    const { spec, sourceValue } = props;

    // 優先檢查是否為數量明細 (觸發總量連動)
    // 只有在有選項的情況下才進入分配模式，否則退回一般編輯器
    if (sourceValue && spec.options?.length > 0) {
        return <QuantityAllocationEditor {...props} />;
    }

    // 物件化查找渲染器
    let type = spec.type;
    // 如果有選項但非 multiselect，預設導向 select
    if (spec.options?.length > 0 && type !== 'multiselect' && type !== 'number_with_unit' && type !== 'boolean') {
        type = 'select';
    }

    const Renderer = SpecRenderers[type] || SpecRenderers.default;
    return <Renderer {...props} />;
}
