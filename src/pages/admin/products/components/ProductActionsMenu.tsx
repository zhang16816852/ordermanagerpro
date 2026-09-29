import { MoreHorizontal, Pencil, Copy, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Product } from './productsListTypes';

interface ProductActionsMenuProps {
    product: Product;
    onEdit: (p: Product) => void;
    onCopy: (p: Product) => void;
    onDelete: (p: Product) => void;
}

export function ProductActionsMenu({ product, onEdit, onCopy, onDelete }: ProductActionsMenuProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" aria-label="更多操作">
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuItem onClick={() => onEdit(product)}>
                    <Pencil className="mr-2 h-4 w-4" /> 編輯詳情
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onCopy(product)}>
                    <Copy className="mr-2 h-4 w-4" /> 複製產品
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={() => onDelete(product)}>
                    <Trash2 className="mr-2 h-4 w-4" /> 刪除產品
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
