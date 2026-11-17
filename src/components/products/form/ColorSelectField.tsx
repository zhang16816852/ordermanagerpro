import { useState, useMemo, useEffect, useCallback } from 'react';
import { useColorStore } from '@/store/useColorStore';
import { ProductColor } from '@/types/colors';
import { Check, ChevronsUpDown, Plus, Search, X, Palette, GripVertical } from 'lucide-react';
import { QuickColorAdd } from '@/pages/admin/libraries/colors/QuickColorAdd';
import { Button } from '@/components/ui/button';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

interface SortableColorPillProps {
  color: ProductColor;
  onRemove: (e: React.MouseEvent) => void;
}

function SortableColorPill({ color, onRemove }: SortableColorPillProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: color.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <Badge
      ref={setNodeRef}
      style={{
        ...style,
        backgroundColor: color.hex_code || 'transparent',
        color: color.hex_code ? getContrastColor(color.hex_code) : 'inherit',
        borderColor: 'rgba(0,0,0,0.1)',
      }}
      variant="outline"
      className="flex items-center gap-1 pr-1 pl-2 h-6 cursor-grab active:cursor-grabbing touch-none"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3 w-3 opacity-40 shrink-0" />
      {color.name} ({color.code})
      <X
        className="h-3 w-3 cursor-pointer hover:bg-black/10 rounded-full shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(e);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </Badge>
  );
}

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = selectedColorIds.indexOf(String(active.id));
    const newIndex = selectedColorIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(selectedColorIds, oldIndex, newIndex));
  }, [selectedColorIds, onChange]);

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

  // 已選顏色置頂，其餘維持庫內順序
  const sortedColors = useMemo(() => {
    return [...colors].sort((a, b) => {
      const aSelected = selectedColorIds.includes(a.id);
      const bSelected = selectedColorIds.includes(b.id);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }, [colors, selectedColorIds]);

  return (
    <div className="space-y-2">
      <div className="min-h-[32px] p-1 border rounded-md bg-background/50">
        {selectedColors.length === 0 && (
          <div className="flex items-center min-h-[32px]">
            <span className="text-xs text-muted-foreground p-1">尚未選擇顏色</span>
          </div>
        )}
        {selectedColors.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={selectedColorIds} strategy={horizontalListSortingStrategy}>
              <div className="flex flex-wrap gap-1">
                {selectedColors.map(color => (
                  <SortableColorPill
                    key={color.id}
                    color={color}
                    onRemove={() => toggleColor(color.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
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
        <PopoverContent className="w-[320px] max-w-[90vw] p-0" align="start">
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
                      type="button"
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
                  {sortedColors.map((color) => (
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
