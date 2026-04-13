import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SupplierProductMapping } from '../../hooks/useSupplierMappings';

interface MappedRulesListProps {
  mappings: SupplierProductMapping[];
  onDelete: (id: string) => void;
  isLoading?: boolean;
}

export function MappedRulesList({ mappings, onDelete, isLoading }: MappedRulesListProps) {
  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">載入對照規則中...</div>;
  }

  if (mappings.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
        尚無產品對照規則
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>廠商產品代號</TableHead>
            <TableHead>廠商產品名稱</TableHead>
            <TableHead>系統內部產品</TableHead>
            <TableHead className="w-[100px] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mappings.map((rule) => {
            const internalProd = rule.internal_product?.name || '未知產品';
            const internalVar = rule.internal_variant?.name || '';
            const internalLabel = internalVar ? `${internalProd} (${internalVar})` : internalProd;

            return (
              <TableRow key={rule.id}>
                <TableCell className="font-medium">{rule.vendor_product_id}</TableCell>
                <TableCell>{rule.vendor_product_name || '-'}</TableCell>
                <TableCell>{internalLabel}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive  hover:text-destructive/90"
                    onClick={() => {
                      if (confirm('確定要刪除此對照規則嗎？')) {
                        onDelete(rule.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
