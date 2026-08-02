import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Edit, Trash2 } from 'lucide-react';
import { FullDeviceModel as DeviceModel } from '@/types/device-models';
import { UseMutationResult } from '@tanstack/react-query';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from '@/components/ui/pagination';

interface DeviceModelListViewProps {
  isLoading: boolean;
  models: DeviceModel[];
  totalCount: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  deviceBrands: any[];
  openEdit: (model: DeviceModel) => void;
  updateMutation: UseMutationResult<any, Error, { id: string; values: any }, unknown>;
  deleteMutation: UseMutationResult<void, Error, string, unknown>;
}

export function DeviceModelListView({
  isLoading,
  models,
  totalCount,
  page,
  totalPages,
  onPageChange,
  deviceBrands,
  openEdit,
  updateMutation,
  deleteMutation
}: DeviceModelListViewProps) {
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('ellipsis');
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="border rounded-lg bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>型號標籤名稱</TableHead>
            <TableHead>品牌</TableHead>
            <TableHead>類型</TableHead>
            <TableHead>尺寸</TableHead>
            <TableHead className="w-[100px] text-center">排序</TableHead>
            <TableHead className="w-[100px] text-center">狀態</TableHead>
            <TableHead className="w-[120px] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center">載入中...</TableCell>
            </TableRow>
          ) : models.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">尚無型號資料</TableCell>
            </TableRow>
          ) : (
            models.map((model) => (
              <TableRow key={model.id} className={!model.is_active ? 'opacity-60 bg-muted/30' : ''}>
                <TableCell>
                  <div className="font-medium">{model.name}</div>
                  {model.aliases && model.aliases.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {model.aliases.map((alias, i) => (
                        <span key={i} className="text-[9px] bg-primary/5 text-primary border border-primary/10 px-1 rounded">
                          {alias}
                        </span>
                      ))}
                    </div>
                  )}
                  {model.device_series && <div className="text-[10px] text-muted-foreground mt-0.5">{model.device_series}</div>}
                  {model.device_remarks && <div className="text-[10px] text-muted-foreground truncate w-max max-w-[150px]" title={model.device_remarks}>{model.device_remarks}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground">{model.brand_id ? deviceBrands.find((b: any) => b.id === model.brand_id)?.name || '-' : '-'}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div>{model.device_type || '-'}</div>
                  {model.release_date && <div className="text-[10px] bg-muted/50 px-1 inline-block rounded">{model.release_date}</div>}
                </TableCell>
                <TableCell className="text-muted-foreground">{model.screen_size || '-'}</TableCell>
                <TableCell className="text-center">{model.sort_order}</TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={model.is_active || false}
                    onCheckedChange={(checked) => updateMutation.mutate({ id: model.id, values: { is_active: checked } })}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(model)}>
                      <Edit className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm(`確定要刪除「${model.name}」嗎？此操作不可逆。`)) {
                          deleteMutation.mutate(model.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <span className="text-sm text-muted-foreground">
            共 {totalCount} 筆，第 {page}/{totalPages} 頁
          </span>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  className={page <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              {getPageNumbers().map((p, i) =>
                p === 'ellipsis' ? (
                  <PaginationItem key={`e${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      isActive={p === page}
                      onClick={() => onPageChange(p)}
                      className="cursor-pointer"
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext
                  onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                  className={page >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
