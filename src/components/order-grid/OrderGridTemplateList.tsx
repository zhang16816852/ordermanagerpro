import React, { useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, Search, LayoutGrid } from 'lucide-react';
import { useTableTemplates } from '@/hooks/useTableTemplates';
import { OrderGridTemplateFormDialog } from './OrderGridTemplateFormDialog';
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

  const filtered = templates.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

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
        <Button onClick={handleCreate} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          新增範本
        </Button>
      </div>

      <div className="border rounded-lg bg-background">
        <Table>
          <TableHeader>
            <TableRow>
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
                <TableCell colSpan={6} className="h-24 text-center">
                  載入中...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  {search ? '找不到符合的範本' : '尚無範本，點擊「新增範本」開始'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((template) => (
                <TableRow key={template.id}>
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
    </div>
  );
}
