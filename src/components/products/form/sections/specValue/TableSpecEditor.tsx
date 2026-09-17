import { useSpecStore } from '@/store/useSpecStore';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Settings2, X, Copy } from 'lucide-react';
import { formatSpecValue } from '@/utils/specLogic';
import type { SpecValueEditorProps } from './types';

export function TableSpecEditor({ spec, value, onChange, variantMode }: SpecValueEditorProps) {
    const { specMap } = useSpecStore();
    const columns = spec.configuration?.columns || [];
    const rows = Array.isArray(value) ? value : [];

    const addRow = () => {
        const newRow = columns.reduce((acc: any, col: any) => {
            acc[col.id || col.name] = (col.type === 'multiselect' || (col.type === 'link' && specMap.get(col.linkedSpecId)?.type === 'multiselect')) ? [] : '';
            return acc;
        }, {});
        onChange([...rows, newRow]);
    };

    const removeRow = (idx: number) => {
        onChange(rows.filter((_: any, i: number) => i !== idx));
    };

    const duplicateRow = (idx: number) => {
        const copy = JSON.parse(JSON.stringify(rows[idx]));
        const next = [...rows];
        next.splice(idx + 1, 0, copy);
        onChange(next);
    };

    const updateCell = (rowIdx: number, colKey: string, val: any) => {
        const next = [...rows];
        next[rowIdx] = { ...next[rowIdx], [colKey]: val };
        onChange(next);
    };

    const content = (
        <div className="space-y-3">
            <div className="overflow-x-auto border rounded-md bg-background shadow-sm">
                <table className="w-full text-[11px] border-collapse">
                    <thead className="bg-muted/50 border-b">
                        <tr>
                            {columns.map((col: any) => (
                                <th key={col.id || col.name} className="px-2 py-2 text-left font-bold text-muted-foreground border-r last:border-r-0">
                                    {col.name}
                                    {col.suffix && <span className="ml-1 opacity-50 font-normal">({col.suffix})</span>}
                                </th>
                            ))}
                            <th className="w-8"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {rows.map((row: any, rowIdx: number) => (
                            <tr key={rowIdx} className="hover:bg-muted/5 transition-colors">
                                {columns.map((col: any) => {
                                    const colKey = col.id || col.name;
                                    
                                    let finalType = col.type;
                                    let finalOptions = col.options || [];
                                    let cellSuffix = col.suffix;
                                    
                                    if (col.type === 'link' && col.linkedSpecId) {
                                        const linkedSpec = specMap.get(col.linkedSpecId);
                                        if (linkedSpec) {
                                            finalOptions = linkedSpec.options || [];
                                            finalType = linkedSpec.type;
                                            
                                            if (finalType === 'number_with_unit' && finalOptions.length > 0 && !cellSuffix) {
                                                const unitMatch = finalOptions[0].match(/(.+?)\((.+?)\)/);
                                                cellSuffix = unitMatch ? unitMatch[2] : finalOptions[0];
                                            } else if (finalOptions.length > 0 && !['multiselect', 'number_with_unit', 'boolean', 'text', 'default', 'table'].includes(finalType)) {
                                                finalType = 'select';
                                            }
                                        }
                                    }

                                    return (
                                        <td key={colKey} className="p-1 border-r last:border-r-0 relative group/cell">
                                            <div className="flex items-center gap-1">
                                                {col.prefix && <span className="text-[9px] text-muted-foreground shrink-0">{col.prefix}</span>}
                                                
                                                {finalType === 'select' ? (
                                                    <select 
                                                        className="w-full h-7 bg-transparent border-none focus:ring-1 focus:ring-primary rounded px-1 outline-none text-xs"
                                                        value={row[colKey] || ''}
                                                        onChange={(e) => updateCell(rowIdx, colKey, e.target.value)}
                                                    >
                                                        <option value="">-</option>
                                                        {finalOptions.map((o: string) => <option key={o} value={o}>{o}</option>)}
                                                    </select>
                                                ) : finalType === 'multiselect' ? (
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <Button variant="ghost" size="sm" className="h-7 px-1 text-[10px] w-full justify-between hover:bg-muted/50">
                                                                <span className="truncate">{Array.isArray(row[colKey]) ? row[colKey].join(',') : '-'}</span>
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-48 p-2" align="start">
                                                            <div className="space-y-1">
                                                                <p className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-tight">多選項目</p>
                                                                {finalOptions.map((opt: string) => {
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
                                                        type={finalType === 'number_with_unit' ? 'number' : 'text'}
                                                        value={row[colKey] || ''}
                                                        onChange={(e) => updateCell(rowIdx, colKey, e.target.value)}
                                                        placeholder="..."
                                                    />
                                                )}

                                                {cellSuffix && <span className="text-[9px] text-muted-foreground shrink-0">{cellSuffix}</span>}
                                            </div>
                                        </td>
                                    );
                                })}
                                                <td className="p-1 text-center">
                                                    <div className="flex items-center justify-center gap-0.5">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            type="button"
                                                            className="h-6 w-6 text-muted-foreground hover:text-primary"
                                                            title="複製此列"
                                                            onClick={() => duplicateRow(rowIdx)}
                                                        >
                                                            <Copy className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button 
                                                            variant="ghost" 
                                                            size="icon" 
                                                            type="button"
                                                            className="h-6 w-6 text-muted-foreground hover:text-destructive" 
                                                            onClick={() => removeRow(rowIdx)}
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {rows.length === 0 && (
                    <div className="py-6 text-center">
                        <p className="text-[11px] text-muted-foreground italic">目前尚未添加任何數據行</p>
                    </div>
                )}
            </div>
            <Button variant="outline" size="sm" className="w-full h-8 border-dashed bg-muted/5 hover:bg-muted/10 text-muted-foreground" onClick={addRow}>
                + 添加一列數據
            </Button>
        </div>
    );

    if (variantMode) {
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" type="button" className="h-8 px-2 text-[10px] w-full justify-between font-normal group-hover:border-primary/30 transition-colors">
                        <span className="truncate">{rows.length > 0 ? formatSpecValue(value, spec) : '未設定'}</span>
                        <Settings2 className="h-3 w-3 ml-1 opacity-50 shrink-0" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3 shadow-xl" align="center">
                    <div className="text-xs font-bold mb-3 border-b pb-1.5 flex items-center gap-2">
                        <Settings2 className="h-3.5 w-3.5 text-primary" />
                        {spec.name} 詳細數據行
                    </div>
                    {content}
                </PopoverContent>
            </Popover>
        );
    }

    return content;
}