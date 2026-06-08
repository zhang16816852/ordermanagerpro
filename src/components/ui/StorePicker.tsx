import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

export interface StoreOption {
  id: string;
  name: string;
  code?: string | null;
  brand?: string | null;
}

export interface StorePickerProps {
  stores: StoreOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  valueField?: 'id' | 'brand';
  placeholder?: string;
  searchPlaceholder?: string;
  notFoundText?: string;
  disabled?: boolean;
}

export function StorePicker({
  stores,
  value,
  onChange,
  multiple = false,
  valueField = 'id',
  placeholder = '選擇連鎖客戶...',
  searchPlaceholder = '搜尋連鎖客戶...',
  notFoundText = '找不到符合的客戶',
  disabled = false,
}: StorePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedValues = useMemo(() => {
    return Array.isArray(value) ? value : value ? [value] : [];
  }, [value]);

  const selectedStores = useMemo(() => {
    return stores.filter(s => selectedValues.includes(s[valueField] as string));
  }, [stores, selectedValues, valueField]);

  const filteredStores = useMemo(() => {
    if (!search) return stores;
    const q = search.toLowerCase();
    return stores.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.code && s.code.toLowerCase().includes(q))
    );
  }, [stores, search]);

  const handleSelect = (selectedValue: string) => {
    if (multiple) {
      const next = selectedValues.includes(selectedValue)
        ? selectedValues.filter(v => v !== selectedValue)
        : [...selectedValues, selectedValue];
      onChange(next);
    } else {
      onChange(selectedValue);
      setOpen(false);
      setSearch('');
    }
  };

  const handleRemove = (removedValue: string) => {
    if (multiple) {
      onChange(selectedValues.filter(v => v !== removedValue));
    } else {
      onChange('');
    }
  };

  const handleClear = () => {
    onChange(multiple ? [] : '');
    setSearch('');
  };

  return (
    <div className="space-y-2">
      {multiple && selectedStores.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedStores.map(store => (
            <Badge key={store.id} variant="secondary" className="gap-1 pr-1">
              {store.code ? `${store.code} - ${store.name}` : store.name}
              <button
                type="button"
                className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
                onClick={() => handleRemove(store[valueField] as string)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              'w-full justify-between',
              !multiple && !value && 'text-muted-foreground'
            )}
          >
            {!multiple && selectedStores.length > 0
              ? selectedStores[0].code
                ? `${selectedStores[0].code} - ${selectedStores[0].name}`
                : selectedStores[0].name
              : placeholder}
            <div className="ml-2 flex items-center gap-1">
              {!multiple && value && (
                <span
                  role="button"
                  tabIndex={0}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  onClick={(e) => { e.stopPropagation(); handleClear(); }}
                >
                  <X className="h-3 w-3" />
                </span>
              )}
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command shouldFilter={false}>
            <div className="flex items-center border-b px-3">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <input
                className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <CommandList>
              {filteredStores.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {notFoundText}
                </div>
              )}
              {filteredStores.map((store) => {
                const itemValue = store[valueField] as string;
                const isSelected = selectedValues.includes(itemValue);
                return (
                  <div
                    key={store.id}
                    role="option"
                    aria-selected={isSelected}
                    data-disabled={false}
                    className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
                    onClick={() => handleSelect(itemValue)}
                  >
                    <div className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-sm border',
                      multiple && isSelected && 'bg-primary border-primary text-primary-foreground'
                    )}>
                      {multiple && isSelected && <Check className="h-3 w-3" />}
                    </div>
                    <div className="flex flex-col">
                      <span>{store.name}</span>
                      {store.code && (
                        <span className="text-xs text-muted-foreground">{store.code}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
