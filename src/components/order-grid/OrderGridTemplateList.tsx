import React, { useState, useMemo, useRef } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import {
  Plus, Pencil, Trash2, Search, LayoutGrid,
  Upload, Download,
} from 'lucide-react';
import { useTableTemplates } from '@/hooks/useTableTemplates';
import { OrderGridTemplateFormDialog } from './OrderGridTemplateFormDialog';
import { ImportPreviewDialog } from '@/components/shared/ImportPreviewDialog';
import { exportTemplatesToExcel } from '@/utils/templateExport';
import { parseTemplateExcel, type ParsedTemplate } from '@/utils/templateImport';
import type { OrderGridTemplateWithProducts, DimensionConfig } from '@/types/order-grid';
import type { ProductWithPricing } from '@/types/product';

interface OrderGridTemplateListProps {
  onSelect?: (template: OrderGridTemplateWithProducts) => void;
  showUseButton?: boolean;
  products?: ProductWithPricing[];
}

export function OrderGridTemplateList({
  onSelect,
  showUseButton = false,
  products = [],
}: OrderGridTemplateListProps) {
  const {
    templates,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  } = useTableTemplates();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<OrderGridTemplateWithProducts | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importData, setImportData] = useState<ParsedTemplate[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = templates.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const isAllSelected = filtered.length > 0 && selectedIds.size === filtered.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((t) => t.id)));
    }
  };

  const existingIds = useMemo(
    () => new Set(templates.map((t) => t.id)),
    [templates],
  );

  const variantLookup = useMemo(() => {
    const map = new Map<string, { sku: string; name: string; productName: string; productId: string }>();
    for (const p of products) {
      for (const v of p.variants || []) {
        map.set(v.id, {
          sku: v.sku,
          name: v.name,
          productName: p.name,
          productId: p.id,
        });
      }
    }
    return map;
  }, [products]);

  const handleExport = () => {
    const selected = templates.filter((t) => selectedIds.has(t.id));
    exportTemplatesToExcel(selected, variantLookup);
    toast.success(`已匯出 ${selected.length} 個範本`);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const buf = evt.target?.result as ArrayBuffer;
      const result = parseTemplateExcel(buf, existingIds);
      if (result.errors.length > 0) {
        toast.error(`解析失敗：${result.errors[0]}`);
        return;
      }
      setImportData(result.templates);
      setImportOpen(true);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleImportConfirm = async () => {
    setImporting(true);
    let successCount = 0;
    for (const pt of importData) {
      try {
        if (!pt.isNew && pt.uuid) {
          deleteTemplate(pt.uuid);
        }
        createTemplate({
          name: pt.name,
          description: pt.description,
          row_config: pt.rowConfig,
          col_config: pt.colConfig,
          tab_config: pt.tabConfig,
          variant_ids: pt.variantIds,
        });
        successCount++;
      } catch {
        toast.error(`匯入「${pt.name}」失敗`);
      }
    }
    toast.success(`成功匯入 ${successCount}/${importData.length} 個範本`);
    setImportOpen(false);
    setImportData([]);
    setImporting(false);
  };

  const handleCreate = () => {
    setEditingTemplate(null);
    setDialogOpen(true);
  };

  const handleEdit = (template: OrderGridTemplateWithProducts) => {
    setEditingTemplate(template);
    setDialogOpen(true);
  };

  const handleDelete = (template: OrderGridTemplateWithProducts) => {
    if (confirm(`確定要刪除「${template.name}」嗎？`)) {
      deleteTemplate(template.id);
    }
  };

  const handleSave = (data: {
    name: string;
    description?: string;
    row_config: DimensionConfig;
    col_config: DimensionConfig;
    tab_config?: DimensionConfig | null;
    variant_ids: string[];
  }) => {
    if (editingTemplate) {
      updateTemplate(editingTemplate.id, data);
    } else {
      createTemplate(data as any);
    }
    setDialogOpen(false);
  };

  const formatDimensions = (config: DimensionConfig) => {
    if (config.type === 'variant_field') {
      return `${config.label} (${config.field})`;
    }
    if (config.type === 'custom') {
      return `${config.label} (${config.values?.length || 0} 個值)`;
    }
    return config.label;
  };

  const importColumns = [
    { key: 'name', header: '範本名稱', width: '200px' },
    { key: 'description', header: '說明', width: '250px' },
    {
      key: 'variantCount',
      header: 'Variants',
      width: '80px',
      align: 'center' as const,
      render: (_: any, row: ParsedTemplate) => String(row.variantIds.length),
    },
    {
      key: 'isNew',
      header: '動作',
      width: '100px',
      align: 'center' as const,
      render: (_: any, row: ParsedTemplate) => (
        <Badge variant={row.isNew ? 'default' : 'outline'} className="text-xs">
          {row.isNew ? '新增' : '覆蓋'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋範本..."
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="file"
            accept=".xlsx"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-1.5" />
            匯入
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={selectedIds.size === 0}
          >
            <Download className="h-4 w-4 mr-1.5" />
            匯出{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </Button>
          <Button onClick={handleCreate} size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            新增範本
          </Button>
        </div>
      </div>

      <div className="border rounded-lg bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead>範本名稱</TableHead>
              <TableHead>Row 維度</TableHead>
              <TableHead>Col 維度</TableHead>
              <TableHead>Tab</TableHead>
              <TableHead className="text-center">產品數</TableHead>
              <TableHead className="w-[120px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  載入中...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-24 text-center text-muted-foreground"
                >
                  {search ? '找不到符合的範本' : '尚無範本，點擊「新增範本」開始'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((template) => (
                <TableRow key={template.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(template.id)}
                      onCheckedChange={() => toggleSelect(template.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{template.name}</div>
                        {template.description && (
                          <div className="text-xs text-muted-foreground">
                            {template.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {formatDimensions(template.row_config)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {formatDimensions(template.col_config)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {template.tab_config ? (
                      <Badge variant="outline" className="text-xs">
                        {formatDimensions(template.tab_config)}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {template.template_variants?.length || 0}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {showUseButton && onSelect && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => onSelect(template)}
                        >
                          使用
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleEdit(template)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(template)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <OrderGridTemplateFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={editingTemplate}
        products={products}
        onSave={handleSave}
      />

      <ImportPreviewDialog
        open={importOpen}
        onOpenChange={(open) => { if (!importing) { setImportOpen(open); if (!open) setImportData([]); } }}
        title="範本匯入預覽"
        description="確認以下解析結果，確認無誤後按「確認匯入」寫入。同名範本將會被覆蓋。"
        data={importData}
        columns={importColumns}
        onConfirm={handleImportConfirm}
        isLoading={importing}
        confirmText="確認匯入"
        statusKey="isNew"
      />
    </div>
  );
}
