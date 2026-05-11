import { ProductWithPricing } from "@/types/product";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { calculatePriceRange } from "@/utils/priceUtils";
import { Package, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProductCardProps {
  product: ProductWithPricing;
  onClick?: () => void;
  onInfoClick?: () => void;
}

export function ProductCard({ product, onClick, onInfoClick }: ProductCardProps) {
  const priceRange = calculatePriceRange(
    product.wholesale_price,
    product.variants?.map((v) => v.effective_wholesale_price) || []
  );

  return (
    <Card 
      className="group flex flex-col overflow-hidden hover:shadow-lg transition-all duration-300 border-muted/60 hover:border-primary/50 cursor-pointer"
      onClick={onClick}
    >
      {/* 產品圖片區域 */}
      <div className="aspect-square bg-muted/30 relative flex items-center justify-center overflow-hidden">
        {product.image_url ? (
          <img 
            src={product.image_url} 
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-muted-foreground/30">
            <Package className="w-12 h-12 mb-2" />
            <span className="text-xs font-medium uppercase tracking-wider">No Image</span>
          </div>
        )}
        
        {/* 懸浮動作按鈕 */}
        <div className="absolute top-2 right-2 flex flex-col gap-2 translate-x-12 group-hover:translate-x-0 transition-transform duration-300">
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-full shadow-md bg-background/80 backdrop-blur-sm hover:bg-primary hover:text-primary-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onInfoClick?.();
            }}
          >
            <Info className="h-4 w-4" />
          </Button>
        </div>

        {/* 變體標籤 */}
        {product.has_variants && (
          <div className="absolute bottom-2 left-2">
            <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm text-[10px] font-bold px-1.5 py-0">
              {product.variants?.length} 規格
            </Badge>
          </div>
        )}
      </div>

      <CardContent className="p-3 flex-1 flex flex-col gap-1">
        <div className="text-xs font-mono text-muted-foreground truncate">
          {product.sku}
        </div>
        <h3 className="font-semibold text-sm line-clamp-2 leading-tight group-hover:text-primary transition-colors">
          {product.name}
        </h3>
        {product.description && (
          <p className="text-[11px] text-muted-foreground line-clamp-1 italic mt-1">
            {product.description}
          </p>
        )}
      </CardContent>

      <CardFooter className="px-3 py-2 border-t bg-muted/5 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground leading-none">批發價</span>
          <span className="font-bold text-primary">
            {priceRange.display}
          </span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
          查看詳情
        </Button>
      </CardFooter>
    </Card>
  );
}
