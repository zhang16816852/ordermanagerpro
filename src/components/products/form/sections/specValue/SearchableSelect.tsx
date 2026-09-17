import { useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown } from 'lucide-react';
import { OTHER_OPTION } from './types';
import { OtherSuggestionInput } from './OtherSuggestionInput';

export function SearchableSelect({ options, value, onChange, placeholder }: {
    options: string[];
    value: any;
    onChange: (v: any) => void;
    placeholder?: string;
}) {
    const [open, setOpen] = useState(false);
    const [otherMode, setOtherMode] = useState(false);
    const hasOther = options.includes(OTHER_OPTION);
    const customValue = hasOther && !options.includes(String(value ?? '')) && String(value ?? '').trim() !== ''
        ? String(value)
        : null;
    const showOther = hasOther && (customValue !== null || otherMode);

    return (
        <div className="space-y-1.5">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" type="button" className="h-9 w-full justify-between font-normal">
                        <span className="truncate">
                            {customValue !== null ? `${OTHER_OPTION}: ${customValue}` : (value ? String(value) : (placeholder || '請選擇'))}
                        </span>
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                        <CommandInput placeholder="搜尋..." className="h-9" />
                        <CommandList>
                            <CommandEmpty>無符合項目</CommandEmpty>
                            <CommandGroup>
                                {options.map(opt => (
                                    <CommandItem
                                        key={opt}
                                        value={opt}
                                        onSelect={() => { setOtherMode(false); onChange(opt); setOpen(false); }}
                                    >
                                        <Check className={`mr-2 h-3.5 w-3.5 ${value === opt ? 'opacity-100' : 'opacity-0'}`} />
                                        {opt}
                                    </CommandItem>
                                ))}
                                {hasOther && (
                                    <CommandItem
                                        key={OTHER_OPTION}
                                        value={OTHER_OPTION}
                                        onSelect={() => {
                                            setOtherMode(true);
                                            if (customValue !== null) onChange('');
                                            setOpen(false);
                                        }}
                                    >
                                        <Check className={`mr-2 h-3.5 w-3.5 ${customValue !== null || otherMode ? 'opacity-100' : 'opacity-0'}`} />
                                        {OTHER_OPTION}
                                    </CommandItem>
                                )}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            {showOther && (
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