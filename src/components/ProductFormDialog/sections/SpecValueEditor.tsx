import React from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Settings2, X } from 'lucide-react';
import { CategorySpec } from '@/hooks/useCategorySpecs';
import { formatSpecValue } from '@/utils/specLogic';

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

    // 2. 帶單位數字 (Number with Unit) - 支援複合型
    number_with_unit: ({ spec, value, onChange, sourceValue, variantMode }) => {
        const labels = spec.options || [];
        
        // 單一欄位模式 (相容舊版或只有一個單位)
        if (labels.length <= 1) {
            return (
                <div className="flex items-center space-x-2">
                    <Input
                        type="number"
                        value={value || ''}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={sourceValue ? `建議值: ${sourceValue}` : "數值"}
                        className="h-9"
                    />
                    {labels[0] && (
                        <span className="text-sm text-muted-foreground whitespace-nowrap">{labels[0]}</span>
                    )}
                </div>
            );
        }

        // 複合欄位模式
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
                        <Button variant="outline" size="sm" className="h-8 px-2 text-[10px] w-full justify-between font-normal">
                            <span className="truncate">{formatSpecValue(value) || '未設定'}</span>
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
    },

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

    // 5. 預設輸入框 (Default/Text) - 支援複合型
    default: ({ spec, value, onChange, sourceValue, variantMode }) => {
        const labels = spec.options || [];

        // 單一欄位模式 (傳統文字輸入)
        if (labels.length === 0) {
            return (
                <Input
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={sourceValue ? `來自父級: ${sourceValue}` : `輸入${spec.name}`}
                    className="h-9"
                />
            );
        }

        // 複合欄位模式
        const currentVals = (typeof value === 'object' && value !== null) ? value : {};
        
        const content = (
            <div className={`grid grid-cols-1 ${variantMode ? 'w-56 p-3' : 'gap-2 mt-1'}`}>
                {labels.map((label) => (
                    <div key={label} className="flex items-center space-x-2 bg-muted/20 p-1.5 rounded-md border border-dashed border-muted-foreground/20 mb-2 last:mb-0">
                        <span className="text-[10px] font-bold text-muted-foreground min-w-[40px] truncate" title={label}>{label}</span>
                        <Input
                            value={currentVals[label] || ''}
                            onChange={(e) => onChange({ ...currentVals, [label]: e.target.value })}
                            className="h-7 text-xs flex-1"
                            placeholder="..."
                        />
                    </div>
                ))}
            </div>
        );

        if (variantMode) {
            return (
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 px-2 text-[10px] w-full justify-between font-normal">
                            <span className="truncate">{formatSpecValue(value) || '未設定'}</span>
                            <Settings2 className="h-3 w-3 ml-1 opacity-50 shrink-0" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3" align="center">
                        <div className="text-xs font-bold mb-3 border-b pb-1 flex items-center gap-2">
                            <Settings2 className="h-3 w-3" /> {spec.name} 詳細內容
                        </div>
                        {content}
                    </PopoverContent>
                </Popover>
            );
        }

        return content;
    },

    // 6. 表格型規格 (Table/Grid)
    table: ({ spec, value, onChange, variantMode }) => {
        const columns = (spec as any).configuration?.columns || [];
        const rows = Array.isArray(value) ? value : [];

        const addRow = () => {
            const newRow = columns.reduce((acc: any, col: any) => {
                acc[col.id || col.name] = col.type === 'multiselect' ? [] : '';
                return acc;
            }, {});
            onChange([...rows, newRow]);
        };

        const removeRow = (idx: number) => {
            onChange(rows.filter((_, i) => i !== idx));
        };

        const updateCell = (rowIdx: number, colKey: string, val: any) => {
            const next = [...rows];
            next[rowIdx] = { ...next[rowIdx], [colKey]: val };
            onChange(next);
        };

        const content = (
            <div className="space-y-3">
                <div className="overflow-x-auto border rounded-md bg-background">
                    <table className="w-full text-[11px] border-collapse">
                        <thead className="bg-muted/50 border-b">
                            <tr>
                                {columns.map((col: any) => (
                                    <th key={col.id || col.name} className="px-2 py-1.5 text-left font-bold text-muted-foreground border-r last:border-r-0">{col.name}</th>
                                ))}
                                <th className="w-8"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {rows.map((row: any, rowIdx: number) => (
                                <tr key={rowIdx} className="hover:bg-muted/10">
                                    {columns.map((col: any) => {
                                        const colKey = col.id || col.name;
                                        return (
                                            <td key={colKey} className="p-1 border-r last:border-r-0">
                                                {col.type === 'select' ? (
                                                    <select 
                                                        className="w-full h-7 bg-transparent border-none focus:ring-1 focus:ring-primary rounded px-1 outline-none"
                                                        value={row[colKey] || ''}
                                                        onChange={(e) => updateCell(rowIdx, colKey, e.target.value)}
                                                    >
                                                        <option value="">-</option>
                                                        {col.options?.map((o: string) => <option key={o} value={o}>{o}</option>)}
                                                    </select>
                                                ) : col.type === 'multiselect' ? (
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <Button variant="ghost" size="sm" className="h-7 px-1 text-[10px] w-full justify-between hover:bg-muted/50">
                                                                <span className="truncate">{Array.isArray(row[colKey]) ? row[colKey].join(',') : '-'}</span>
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-48 p-2" align="start">
                                                            <div className="space-y-1">
                                                                <p className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-tight">選擇多項</p>
                                                                {col.options?.map((opt: string) => {
                                                                    const current = Array.isArray(row[colKey]) ? row[colKey] : [];
                                                                    return (
                                                                        <div key={opt} className="flex items-center gap-2 hover:bg-muted/30 p-1 rounded">
                                                                            <Checkbox 
                                                                                id={`cell-${rowIdx}-${colKey}-${opt}`}
                                                                                checked={current.includes(opt)}
                                                                                onCheckedChange={(checked) => {
                                                                                    const next = checked ? [...current, opt] : current.filter((v: any) => v !== opt);
                                                                                    updateCell(rowIdx, colKey, next);
                                                                                }}
                                                                            />
                                                                            <label htmlFor={`cell-${rowIdx}-${colKey}-${opt}`} className="text-xs cursor-pointer flex-1">{opt}</label>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </PopoverContent>
                                                    </Popover>
                                                ) : (
                                                    <Input 
                                                        className="h-7 px-2 border-none bg-transparent focus-visible:ring-1 focus-visible:ring-primary shadow-none text-xs"
                                                        value={row[colKey] || ''}
                                                        onChange={(e) => updateCell(rowIdx, colKey, e.target.value)}
                                                        placeholder="..."
                                                    />
                                                )}
                                            </td>
                                        );
                                    })}
                                    <td className="p-1 text-center">
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeRow(rowIdx)}>
                                            <X className="h-3.3 w-3.3" />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {rows.length === 0 && (
                        <div className="py-6 text-center">
                            <p className="text-[11px] text-muted-foreground italic">尚未新增任何數據行</p>
                        </div>
                    )}
                </div>
                <Button variant="outline" size="sm" className="w-full h-8 border-dashed bg-muted/5 hover:bg-muted/10 text-muted-foreground" onClick={addRow}>
                    + 新增一行數據
                </Button>
            </div>
        );

        if (variantMode) {
            return (
                <Popover>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 px-2 text-[10px] w-full justify-between font-normal group-hover:border-primary/30 transition-colors">
                            <span className="truncate">{rows.length > 0 ? `已設定 ${rows.length} 筆資料` : '未設定'}</span>
                            <Settings2 className="h-3 w-3 ml-1 opacity-50 shrink-0" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-3 shadow-xl" align="center">
                        <div className="text-xs font-bold mb-3 border-b pb-1.5 flex items-center gap-2">
                            <Settings2 className="h-3.5 w-3.5 text-primary" />
                            {spec.name} 詳細數據表
                        </div>
                        {content}
                    </PopoverContent>
                </Popover>
            );
        }

        return content;
    }
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
    // 如果有選項但非 multiselect 且非 text/number/boolean/table，預設導向 select
    if (spec.options?.length > 0 && 
        !['multiselect', 'number_with_unit', 'boolean', 'text', 'default', 'table'].includes(type)) {
        type = 'select';
    }

    const Renderer = SpecRenderers[type] || SpecRenderers.default;
    return <Renderer {...props} />;
}
