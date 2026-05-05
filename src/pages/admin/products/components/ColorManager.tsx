import { useState, useEffect } from 'react';
import { useColorStore } from '@/store/useColorStore';
import { ProductColor } from '@/hooks/useProductColors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Trash2, Pencil, Plus, Save, X, Palette, Search } from 'lucide-react';
import { getContrastColor } from '@/utils/colorUtils';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import * as XLSX from 'xlsx';
import { Download, Upload } from 'lucide-react';

export function ColorManager() {
  const { colors, addColor, updateColor, deleteColor, isLoading, isAdding: storeIsAdding, fetchColors, importColors } = useColorStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProductColor>>({});
  const [isAdding, setIsAdding] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchColors();
  }, []);

  const filteredColors = colors.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.code.toLowerCase().includes(search.toLowerCase())
  );

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

  const handleExport = () => {
    try {
      const data = colors.map(c => ({
        '顏色名稱': c.name,
        'SKU代碼': c.code,
        'HEX色碼': c.hex_code,
        '排序': c.sort_order
      }));
      
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "顏色對照表");
      XLSX.writeFile(wb, `顏色對照表_${new Date().toLocaleDateString()}.xlsx`);
      toast.success('匯出成功');
    } catch (error) {
      toast.error('匯出失敗');
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const formattedColors = data.map(row => ({
          name: row['顏色名稱'] || row['name'],
          code: (row['SKU代碼'] || row['code'] || '').toString().toUpperCase(),
          hex_code: row['HEX色碼'] || row['hex_code'] || '#808080',
          sort_order: parseInt(row['排序'] || row['sort_order']) || 0
        })).filter(c => c.name && c.code);

        if (formattedColors.length === 0) {
          toast.error('找不到有效的顏色資料');
          return;
        }

        const success = await importColors(formattedColors);
        if (success) {
          toast.success(`成功匯入 ${formattedColors.length} 筆顏色`);
        } else {
          toast.error('匯入失敗');
        }
      } catch (error) {
        toast.error('檔案解析失敗');
      }
      e.target.value = ''; // Reset input
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
          <Input 
            placeholder="搜尋顏色名稱或代碼..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={handleExport} disabled={colors.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            匯出
          </Button>
          <div className="relative">
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              onChange={handleImport}
            />
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              匯入
            </Button>
          </div>
          <Button onClick={() => {
            setEditForm({ hex_code: '#808080', sort_order: colors.length });
            setIsAdding(true);
          }} disabled={isAdding || !!editingId}>
            <Plus className="mr-2 h-4 w-4" />
            新增顏色
          </Button>
        </div>
      </div>

      <div className="border rounded-xl overflow-hidden bg-background">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-20">預覽</TableHead>
              <TableHead>顏色名稱</TableHead>
              <TableHead>SKU 代碼</TableHead>
              <TableHead>色碼 (HEX)</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isAdding && (
              <TableRow className="bg-primary/5">
                <TableCell>
                  <div 
                    className="w-10 h-10 rounded-lg border shadow-sm" 
                    style={{ backgroundColor: editForm.hex_code || '#808080' }} 
                  />
                </TableCell>
                <TableCell>
                  <Input 
                    value={editForm.name || ''} 
                    onChange={e => setEditForm({...editForm, name: e.target.value})}
                    placeholder="例：黑色"
                    className="max-w-[200px]"
                  />
                </TableCell>
                <TableCell>
                  <Input 
                    value={editForm.code || ''} 
                    onChange={e => setEditForm({...editForm, code: e.target.value.toUpperCase()})}
                    placeholder="例：BK"
                    className="w-24 font-mono uppercase"
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
                      className="w-28 font-mono text-xs uppercase"
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="default" size="sm" onClick={handleSave}>
                      <Save className="h-4 w-4 mr-2" /> 儲存
                    </Button>
                    <Button variant="ghost" size="sm" onClick={cancelEdit}>
                      取消
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {filteredColors.map(color => (
              <TableRow key={color.id} className="group transition-colors hover:bg-muted/20">
                {editingId === color.id ? (
                  <>
                    <TableCell>
                      <div 
                        className="w-10 h-10 rounded-lg border shadow-sm" 
                        style={{ backgroundColor: editForm.hex_code || '#808080' }} 
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        value={editForm.name || ''} 
                        onChange={e => setEditForm({...editForm, name: e.target.value})}
                        className="max-w-[200px]"
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        value={editForm.code || ''} 
                        onChange={e => setEditForm({...editForm, code: e.target.value.toUpperCase()})}
                        className="w-24 font-mono uppercase"
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
                          className="w-28 font-mono text-xs uppercase"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="default" size="sm" onClick={handleSave}>
                          <Save className="h-4 w-4 mr-2" /> 儲存
                        </Button>
                        <Button variant="ghost" size="sm" onClick={cancelEdit}>
                          取消
                        </Button>
                      </div>
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell>
                      <div 
                        className="w-10 h-10 rounded-lg border shadow-sm flex items-center justify-center text-[10px] font-bold" 
                        style={{ 
                          backgroundColor: color.hex_code || '#808080',
                          color: getContrastColor(color.hex_code)
                        }}
                      >
                        ABC
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{color.name}</TableCell>
                    <TableCell>
                      <code className="bg-muted px-2 py-0.5 rounded-md text-xs font-mono font-bold">{color.code}</code>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{color.hex_code}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => startEdit(color)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(color.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}
            {filteredColors.length === 0 && !isAdding && (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  找不到符合的顏色資料
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
