import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChecklistItem {
  id: string;
  item_name: string;
  is_checked: boolean;
  note: string;
}

export interface ChecklistEditorProps {
  category: 'appearance' | 'functional';
  title: string;
  items: ChecklistItem[];
  onItemsChange: (items: ChecklistItem[]) => void;
  suggestions?: string[];
  compact?: boolean;
}

export function ChecklistEditor({ title, items, onItemsChange, suggestions = [], compact = false }: ChecklistEditorProps) {
  const [newItemName, setNewItemName] = useState('');

  const update = (itemId: string, patch: Partial<ChecklistItem>) => {
    onItemsChange(items.map(i => i.id === itemId ? { ...i, ...patch } : i));
  };

  const addItem = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onItemsChange([...items, { id: crypto.randomUUID(), item_name: trimmed, is_checked: true, note: '' }]);
    setNewItemName('');
  };

  const activeSuggestions = suggestions.filter(s =>
    !items.some(i => i.item_name === s) && s.toLowerCase().includes(newItemName.trim().toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addItem(newItemName);
              }
            }}
            placeholder={`輸入${title}項目或從建議中選取...`}
            className="h-9 text-sm"
            list={`cl-${title}`}
          />
          <datalist id={`cl-${title}`}>
            {activeSuggestions.map(s => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <Button variant="outline" size="sm" onClick={() => addItem(newItemName)} disabled={!newItemName.trim()}>
          <Plus className="h-4 w-4 mr-1" />
          新增
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-3">尚未新增{title}項目</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 p-2 rounded-md border bg-muted/10">
              <Checkbox
                checked={item.is_checked}
                onCheckedChange={(checked) => update(item.id, { is_checked: checked === true })}
                aria-label={item.item_name}
              />
              <span className={cn('text-sm flex-1', !item.is_checked && 'text-muted-foreground line-through')}>
                {item.item_name}
              </span>
              {!compact && (
                <Input
                  value={item.note}
                  onChange={(e) => update(item.id, { note: e.target.value })}
                  placeholder="備註"
                  className="h-7 w-32 text-xs"
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                onClick={() => onItemsChange(items.filter(i => i.id !== item.id))}
                aria-label="刪除項目"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}