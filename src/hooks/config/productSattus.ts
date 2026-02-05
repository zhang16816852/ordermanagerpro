export type ProductStatusType =
    | "active"
    | "discontinued"
    | "preorder"
    | "sold_out";

export const ProductStatusConfig: Record<
    ProductStatusType,
    {
        label: string;
        badgeClass: string;
    }
> = {
    active: {
        label: "上架中",
        badgeClass: "bg-green-500 hover:bg-green-600",
    },
    discontinued: {
        label: "已停售",
        badgeClass: "bg-red-500 hover:bg-red-600",
    },
    preorder: {
        label: "預購中",
        badgeClass: "bg-blue-500 hover:bg-blue-600",
    },
    sold_out: {
        label: "售完停產",
        badgeClass: "bg-yellow-500 hover:bg-yellow-600 text-black",
    },
};
