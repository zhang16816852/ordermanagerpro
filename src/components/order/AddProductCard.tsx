import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { ProductWithPricing } from '@/hooks/useProductCache';

interface AddProductCardProps {
    availableProducts: ProductWithPricing[];
    selectedProductId: string;
    onProductSelect: (productId: string) => void;
    onAddProduct: () => void;
}

export function AddProductCard({
    availableProducts,
    selectedProductId,
    onProductSelect,
    onAddProduct,
}: AddProductCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>新增產品</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex gap-4">
                    <Select value={selectedProductId} onValueChange={onProductSelect}>
                        <SelectTrigger className="flex-1">
                            <SelectValue placeholder="選擇產品" />
                        </SelectTrigger>
                        <SelectContent>
                            {availableProducts.map(product => (
                                <SelectItem key={product.id} value={product.id}>
                                    {product.sku} - {product.name} (${product.wholesale_price})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button onClick={onAddProduct} disabled={!selectedProductId}>
                        <Plus className="mr-2 h-4 w-4" />
                        新增
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
