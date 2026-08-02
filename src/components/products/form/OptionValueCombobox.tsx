import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { OptionGroupWithValues } from "@/types/product";

interface OptionValueComboboxProps {
    group: OptionGroupWithValues;
    value: string;
    onChange: (label: string) => void;
    placeholder?: string;
}

export function OptionValueCombobox({ group, value, onChange, placeholder }: OptionValueComboboxProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState(value || "");
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setInputValue(value || "");
    }, [value]);

    const filteredValues = useMemo(() => {
        if (!inputValue) return group.values;
        const q = inputValue.toLowerCase();
        return group.values.filter(v => (v.label || v.value || "").toLowerCase().includes(q));
    }, [group.values, inputValue]);

    const isExisting = useMemo(() => {
        return group.values.some(v => v.label === inputValue || v.value === inputValue);
    }, [group.values, inputValue]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
                inputRef.current && !inputRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleInputChange = (val: string) => {
        setInputValue(val);
        onChange(val);
        setIsOpen(true);
    };

    const handleSelect = (label: string) => {
        setInputValue(label);
        onChange(label);
        setIsOpen(false);
        inputRef.current?.focus();
    };

    return (
        <div className="relative">
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onFocus={() => setIsOpen(true)}
                placeholder={placeholder || `輸入或選擇${group.name}`}
                className={cn(
                    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
                    "file:border-0 file:bg-transparent file:text-sm file:font-medium",
                    "placeholder:text-muted-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                )}
            />
            {isOpen && filteredValues.length > 0 && (
                <div
                    ref={dropdownRef}
                    className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-60 overflow-auto"
                >
                    {filteredValues.map((optVal) => {
                        const label = optVal.label || optVal.value || "";
                        const isSelected = inputValue === label;
                        return (
                            <div
                                key={optVal.id}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-colors",
                                    isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                                )}
                                onClick={() => handleSelect(label)}
                            >
                                {optVal.hex_code && (
                                    <div
                                        className="w-4 h-4 rounded-full border border-black/10 shrink-0"
                                        style={{ backgroundColor: optVal.hex_code }}
                                    />
                                )}
                                <span>{label}</span>
                                {isSelected && (
                                    <span className="ml-auto text-xs text-muted-foreground">已選</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {inputValue && !isExisting && (
                <p className="text-xs text-muted-foreground mt-0.5 px-1">
                    將建立新選項「{inputValue}」
                </p>
            )}
        </div>
    );
}
