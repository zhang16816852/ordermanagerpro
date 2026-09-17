import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OTHER_OPTION } from './types';
import { OtherSuggestionInput } from './OtherSuggestionInput';
import { SearchableSelect } from './SearchableSelect';
import type { SpecValueEditorProps } from './types';

/**
 * 下拉單選編輯器：選項含「其他」時，選取後出現自訂文字框＋建議框（採用選項值）
 */
export function SelectSpecEditor({ spec, value, onChange }: SpecValueEditorProps) {
    const [otherMode, setOtherMode] = useState(false);
    const options = spec.options || [];
    const hasOther = options.includes(OTHER_OPTION);

    const customValue = hasOther && !options.includes(String(value ?? '')) && String(value ?? '').trim() !== ''
        ? String(value)
        : null;
    const showInput = hasOther && (customValue !== null || otherMode);

    // 選項過多時改為可搜尋的組合框
    if (options.length > 8) {
        return (
            <SearchableSelect options={options} value={value} onChange={onChange} placeholder="請選擇" />
        );
    }

    const handleChange = (v: string) => {
        if (v === OTHER_OPTION) {
            setOtherMode(true);
            if (customValue !== null) onChange('');
        } else {
            setOtherMode(false);
            onChange(v);
        }
    };

    return (
        <div className="space-y-1.5">
            <Select value={showInput ? OTHER_OPTION : (value || '')} onValueChange={handleChange}>
                <SelectTrigger className="h-9">
                    <SelectValue placeholder="請選擇" />
                </SelectTrigger>
                <SelectContent>
                    {options.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {showInput && (
                <OtherSuggestionInput
                    sourceOptions={options}
                    customValue={customValue ?? ''}
                    onCustomChange={onChange}
                    onAdopt={(opt) => { setOtherMode(false); onChange(opt); }}
                />
            )}
        </div>
    );
}