import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { OTHER_OPTION } from './types';
import type { SpecValueEditorProps } from './types';

export function MultiSelectEditor({ spec, value, onChange }: SpecValueEditorProps) {
    const [search, setSearch] = useState('');
    const otherInputRef = useRef<HTMLInputElement>(null);
    const currentVals = Array.isArray(value)
        ? value
        : (typeof value === 'string' && value ? value.split(',') : []);
    const filteredOptions = (spec.options || []).filter(o =>
        !search.trim() || o.toLowerCase().includes(search.trim().toLowerCase())
    );

    const hasOther = (spec.options || []).includes(OTHER_OPTION);
    const isCustomEntry = (v: any) => String(v ?? '').trim() !== '' && !(spec.options || []).includes(String(v));
    const customEntries = currentVals.filter(isCustomEntry);
    const hasPendingMarker = currentVals.filter((v: any) => v === '').length > 0;
    const otherChecked = customEntries.length > 0 || hasPendingMarker || currentVals.includes(OTHER_OPTION);
    const otherText = customEntries[0] ?? '';

    const toggleOther = (checked: boolean) => {
        if (checked) {
            onChange([...currentVals, '']);
        } else {
            onChange(currentVals.filter((v: any) =>
                (spec.options || []).includes(String(v)) && String(v) !== OTHER_OPTION
            ));
        }
    };

    const handleOtherText = (text: string) => {
        const idx = currentVals.findIndex((v: any) => isCustomEntry(v) || v === '' || v === OTHER_OPTION);
        if (idx === -1) onChange([...currentVals, text]);
        else {
            const next = [...currentVals];
            next[idx] = text;
            onChange(next);
        }
    };

    return (
        <div className="flex flex-col gap-1.5 p-2 border rounded-md bg-background shadow-inner">
            <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋選項..."
                className="h-7 text-xs"
            />
            <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto">
                {filteredOptions.length === 0 ? (
                    <p className="text-[10px] text-center py-2 text-muted-foreground">無符合項目</p>
                ) : filteredOptions.map((opt) => (
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
                {hasOther && (
                    <div className="flex items-center gap-2 hover:bg-muted/30 p-1 rounded transition-colors border-t border-dashed pt-1.5 mt-1">
                        <Checkbox
                            id={`multi-${spec.id}-${OTHER_OPTION}`}
                            checked={otherChecked}
                            onCheckedChange={(checked) => {
                                toggleOther(!!checked);
                                setTimeout(() => otherInputRef.current?.focus(), 0);
                            }}
                        />
                        <label htmlFor={`multi-${spec.id}-${OTHER_OPTION}`} className="text-sm cursor-pointer flex-1">{OTHER_OPTION}</label>
                        {otherChecked && (
                            <Input
                                ref={otherInputRef}
                                className="h-7 w-32 text-[11px]"
                                value={otherText}
                                onChange={(e) => handleOtherText(e.target.value)}
                                placeholder="自訂..."
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}