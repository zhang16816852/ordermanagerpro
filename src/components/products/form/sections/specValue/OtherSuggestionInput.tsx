import { useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { OTHER_OPTION } from './types';

/**
 * 「其他」自訂輸入：選了「其他」後出現的文字框＋建議框（採用選項值）
 */
export function OtherSuggestionInput({
    sourceOptions,
    customValue,
    onCustomChange,
    onAdopt,
}: {
    sourceOptions: string[];
    customValue: string;
    onCustomChange: (v: string) => void;
    onAdopt: (opt: string) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const suggestions = (sourceOptions || []).filter(o => o !== OTHER_OPTION && String(o).trim() !== '');

    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground shrink-0">{OTHER_OPTION}</span>
                <Input
                    ref={inputRef}
                    className="h-8 text-xs"
                    value={customValue}
                    onChange={(e) => onCustomChange(e.target.value)}
                    placeholder="輸入自訂內容..."
                />
            </div>
            {suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[9px] text-muted-foreground">或採用選項值：</span>
                    {suggestions.map(opt => (
                        <button
                            key={opt}
                            type="button"
                            onClick={() => onAdopt(opt)}
                            className="text-[10px] px-1.5 py-0.5 rounded border border-muted-foreground/20 bg-muted/20 hover:bg-muted/60 text-muted-foreground transition-colors"
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}