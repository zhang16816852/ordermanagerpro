import { useState } from 'react';
import { useProductColors, ProductColor } from '@/hooks/useProductColors';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Pencil, Plus, Save, X, Palette } from 'lucide-react';
import { getContrastColor } from '@/utils/colorUtils';
import { toast } from 'sonner';

interface ColorManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ColorManagementDialog({ open, onOpenChange }: ColorManagementDialogProps) {
  const { colors, addColor, updateColor, deleteColor, isLoading } = useProductColors();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProductColor>>({});
  const [isAdding, setIsAdding] = useState(false);

  const startEdit = (color: ProductColor) => {
    setEditingId(color.id);
    setEditForm(color);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
    setIsAdding(false);
  };

  const handleSave = async () => {
    try {
      if (isAdding) {
        if (!editForm.name || !editForm.code) {
          toast.error('請填寫完整資訊');
          return;
        }
        await addColor(editForm);
        toast.success('已新增顏色');
      } else if (editingId) {
        await updateColor(editForm as ProductColor);
        toast.success('已更新顏色');
      }
      cancelEdit();
    } catch (error: any) {
      toast.error('儲存失敗：' + (error.message || '未知錯誤'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此顏色嗎？這可能會影響 SKU 生成一致性。')) return;
    try {
      await deleteColor(id);
      toast.success('已刪除顏色');
    } catch (error: any) {
      toast.error('刪除失敗');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            顏色對照表管理
          </DialogTitle>
          <DialogDescription>
            管理顏色名稱及其對應的 SKU 代碼。SKU 代碼建議使用 2-3 碼縮寫（如黑色 ⮕ BK）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <th className="px-4 py-2 text-left">預覽</th>
                  <th className="px-4 py-2 text-left">顏色名稱</th>
                  <th className="px-4 py-2 text-left">SKU 代碼</th>
                  <th className="px-4 py-2 text-left">色碼 (HEX)</th>
                  <th className="px-4 py-2 text-center w-24">操作</th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isAdding && (
                  <TableRow className="bg-muted/50">
                    <TableCell>
                      <div 
                        className="w-8 h-8 rounded border" 
                        style={{ backgroundColor: editForm.hex_code || '#808080' }} 
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        value={editForm.name || ''} 
                        onChange={e => setEditForm({...editForm, name: e.target.value})}
                        className="h-8"
                        placeholder="例：黑色"
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        value={editForm.code || ''} 
                        onChange={e => setEditForm({...editForm, code: e.target.value.toUpperCase()})}
                        className="h-8 w-20"
                        placeholder="例：BK"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input 
                          type="color"
                          value={editForm.hex_code || '#808080'}
                          onChange={e => setEditForm({...editForm, hex_code: e.target.value})}
                          className="h-8 w-8 p-0 border-none cursor-pointer"
                        />
                        <Input 
                          value={editForm.hex_code || ''} 
                          onChange={e => setEditForm({...editForm, hex_code: e.target.value})}
                          className="h-8 w-24 font-mono text-xs"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={handleSave}>
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdit}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {colors.map(color => (
                  <TableRow key={color.id} className="group">
                    {editingId === color.id ? (
                      <>
                        <TableCell>
                          <div 
                            className="w-8 h-8 rounded border" 
                            style={{ backgroundColor: editForm.hex_code || '#808080' }} 
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            value={editForm.name || ''} 
                            onChange={e => setEditForm({...editForm, name: e.target.value})}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            value={editForm.code || ''} 
                            onChange={e => setEditForm({...editForm, code: e.target.value.toUpperCase()})}
                            className="h-8 w-20"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <input 
                              type="color"
                              value={editForm.hex_code || '#808080'}
                              onChange={e => setEditForm({...editForm, hex_code: e.target.value})}
                              className="h-8 w-8 p-0 border-none cursor-pointer bg-transparent"
                            />
                            <Input 
                              value={editForm.hex_code || ''} 
                              onChange={e => setEditForm({...editForm, hex_code: e.target.value})}
                              className="h-8 w-24 font-mono text-xs"
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={handleSave}>
                              <Save className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdit}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>
                          <div 
                            className="w-8 h-8 rounded border flex items-center justify-center text-[10px] font-bold" 
                            style={{ 
                              backgroundColor: color.hex_code || '#808080',
                              color: getContrastColor(color.hex_code)
                            }}
                          >
                            Abc
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{color.name}</TableCell>
                        <TableCell>
                          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{color.code}</code>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{color.hex_code}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center gap-1 opacity-0 group-hover:opacity-100 group-hover:block transition-opacity">
                            {/* Wait, the table cell needs a group class on the Row */}
                          </div>
                          <div className="flex justify-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(color)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(color.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter className="p-6 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>關閉</Button>
          {!isAdding && !editingId && (
            <Button onClick={() => {
              setEditForm({ hex_code: '#808080', sort_order: colors.length });
              setIsAdding(true);
            }}>
              <Plus className="mr-2 h-4 w-4" />
              新增顏色
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
