import { useState, useEffect } from 'react';
import { useColorStore } from '@/store/useColorStore';
import { ProductColor } from '@/types/colors';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { toast } from 'sonner';

interface QuickColorAddProps {
  initialName?: string;
  onSuccess: (color: ProductColor) => void;
  onCancel: () => void;
}

export function QuickColorAdd({ initialName = '', onSuccess, onCancel }: QuickColorAddProps) {
  const { addColor, colors } = useColorStore();
  const [form, setForm] = useState({
    name: initialName,
    code: '',
    hex_code: '#808080'
  });

  // 當 initialName 改變或元件載入時，嘗試產生代碼
  useEffect(() => {
    if (initialName && !form.code) {
      // 簡單產生代碼邏輯：取前兩個字元
      setForm(prev => ({ 
        ...prev, 
        name: initialName,
        code: initialName.substring(0, 2).toUpperCase() 
      }));
    }
  }, [initialName]);

  const handleCreate = async () => {
    if (!form.name || !form.code) {
      toast.error('名稱與代碼為必填');
      return;
    }

    try {
      const res = await addColor({
        name: form.name,
        code: form.code,
        hex_code: form.hex_code,
        sort_order: colors.length
      });

      if (res) {
        toast.success(`已建立顏色：${form.name}`);
        onSuccess(res as ProductColor);
      } else {
        toast.error('建立失敗，名稱或代碼可能重複');
      }
    } catch (err) {
      toast.error('建立失敗');
    }
  };

  return (
    <div className="p-3 space-y-3 bg-background border rounded-md shadow-sm">
      <div className="flex items-center justify-between border-b pb-2 mb-2">
        <h4 className="text-xs font-bold">快速新增顏色</h4>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={onCancel}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      
      <div className="space-y-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-medium">顏色名稱</label>
          <Input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="例如：奶茶色"
            className="h-8 text-xs"
            autoFocus
          />
        </div>
        
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-medium">顏色代碼 (SKU 用)</label>
          <Input
            value={form.code}
            onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
            placeholder="例如：MC"
            className="h-8 text-xs font-mono"
          />
        </div>
        
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-medium">色標</label>
          <div className="flex gap-2">
            <div className="relative">
              <input
                type="color"
                value={form.hex_code}
                onChange={e => setForm({ ...form, hex_code: e.target.value })}
                className="w-8 h-8 p-0 border-none bg-transparent cursor-pointer opacity-0 absolute inset-0 z-10"
              />
              <div 
                className="w-8 h-8 rounded border shadow-sm" 
                style={{ backgroundColor: form.hex_code }}
              />
            </div>
            <Input
              value={form.hex_code}
              onChange={e => setForm({ ...form, hex_code: e.target.value })}
              className="h-8 text-[10px] font-mono flex-1 uppercase"
              placeholder="#000000"
            />
          </div>
        </div>
      </div>
      
      <div className="flex gap-2 pt-1">
        <Button
          variant="secondary"
          className="flex-1 h-8 text-xs"
          onClick={onCancel}
        >
          取消
        </Button>
        <Button
          className="flex-1 h-8 text-xs"
          onClick={handleCreate}
        >
          建立並套用
        </Button>
      </div>
    </div>
  );
}
