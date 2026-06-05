import { useState, useMemo, useEffect } from 'react';
import { useColorStore } from '@/store/useColorStore';
import { ProductColor } from '@/types/colors';
import { Check, ChevronsUpDown, Plus, Search, X, Palette } from 'lucide-react';
import { QuickColorAdd } from '@/pages/admin/libraries/colors/QuickColorAdd';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getContrastColor } from '@/utils/colorUtils';
import { toast } from 'sonner';

interface ColorSelectFieldProps {
  selectedColorIds: string[];
  onChange: (colorIds: string[]) => void;
  multiple?: boolean;
}

export function ColorSelectField({ selectedColorIds, onChange, multiple = true }: ColorSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { colors, addColor, isAdding, fetchColors } = useColorStore();

  useEffect(() => {
    fetchColors();
  }, []);

  // 取得已選取的顏色物件 (保持傳入的順序)
  const selectedColors = useMemo(() => {
    return selectedColorIds
      .map(id => colors.find(c => c.id === id))
      .filter((c): c is ProductColor => !!c);
  }, [selectedColorIds, colors]);

  const [isAddingNew, setIsAddingNew] = useState(false);

  const toggleColor = (id: string) => {
    if (!multiple) {
      onChange([id]);
      setOpen(false);
      return;
    }
    
    if (selectedColorIds.includes(id)) {
      onChange(selectedColorIds.filter(i => i !== id));
    } else {
      onChange([...selectedColorIds, id]);
    }
  };

  const handleQuickAddSuccess = (newColor: ProductColor) => {
    toggleColor(newColor.id);
    setIsAddingNew(false);
    setSearchQuery('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 mb-2 min-h-[32px] p-1 border rounded-md bg-background/50">
        {selectedColors.length === 0 && (
          <span className="text-xs text-muted-foreground p-1">尚未選擇顏色</span>
        )}
        {selectedColors.map(color => (
          <Badge
            key={color.id}
            variant="outline"
            className="flex items-center gap-1 pr-1 pl-2 h-6"
            style={{ 
              backgroundColor: color.hex_code || 'transparent',
              color: color.hex_code ? getContrastColor(color.hex_code) : 'inherit',
              borderColor: 'rgba(0,0,0,0.1)'
            }}
          >
            {color.name} ({color.code})
            <X 
              className="h-3 w-3 cursor-pointer hover:bg-black/10 rounded-full" 
              onClick={(e) => {
                e.stopPropagation();
                toggleColor(color.id);
              }}
            />
          </Badge>
        ))}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            {selectedColorIds.length > 0 
              ? `已選擇 ${selectedColorIds.length} 個顏色` 
              : "選擇顏色..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          {isAddingNew ? (
            <QuickColorAdd 
              initialName={searchQuery}
              onSuccess={handleQuickAddSuccess}
              onCancel={() => setIsAddingNew(false)}
            />
          ) : (
            <Command>
              <CommandInput 
                placeholder="搜尋或新增顏色..." 
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
              <CommandList 
                className="max-h-[300px] overflow-y-auto overscroll-contain"
                onWheel={(e) => e.stopPropagation()}
              >
                <CommandEmpty>
                  <div className="p-2 space-y-2">
                    <p className="text-[10px] text-muted-foreground px-2">找不到顏色 "{searchQuery}"</p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full justify-start gap-2 h-8 text-xs border-dashed"
                      onClick={() => setIsAddingNew(true)}
                    >
                      <Palette className="h-3.5 w-3.5" />
                      建立新顏色並編輯詳情
                    </Button>
                  </div>
                </CommandEmpty>
                <CommandGroup>
                  {colors.map((color) => (
                    <CommandItem
                      key={color.id}
                      value={color.name}
                      onSelect={() => toggleColor(color.id)}
                    >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedColorIds.includes(color.id) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex items-center gap-2 flex-1">
                      <div 
                        className="w-3 h-3 rounded-full border" 
                        style={{ backgroundColor: color.hex_code || 'transparent' }} 
                      />
                      <span>{color.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{color.code}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
