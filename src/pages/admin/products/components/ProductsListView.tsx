import { ProductsTable } from './ProductsTable';
import { ProductsCardList } from './ProductsCardList';
import type { ProductsListViewProps } from './productsListTypes';

export function ProductsListView(props: ProductsListViewProps) {
    return (
        <>
            <div className="hidden md:block">
                <ProductsTable {...props} />
            </div>
            <div className="md:hidden">
                <ProductsCardList {...props} />
            </div>
        </>
    );
}
