import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";
import type { ProductImage } from "@/components/products/images/ProductImageManager";

interface ImageGalleryProps {
    images: ProductImage[];
    coverUrl?: string | null;
}

export function ImageGallery({ images, coverUrl }: ImageGalleryProps) {
    const [activeIndex, setActiveIndex] = useState(0);

    const allImages = useMemo(() => {
        if (images.length > 0) return images;
        if (coverUrl) return [{ id: 'cover', url: coverUrl } as unknown as ProductImage];
        return [];
    }, [images, coverUrl]);

    useEffect(() => { setActiveIndex(0); }, [allImages]);

    if (allImages.length === 0) {
        return (
            <div className="aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden border">
                <div className="flex flex-col items-center text-muted-foreground">
                    <ImageIcon className="h-12 w-12 mb-2" />
                    <span className="text-xs">尚無圖片</span>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <div className="aspect-square bg-muted rounded-lg overflow-hidden border relative group">
                <img
                    src={allImages[activeIndex]?.url}
                    alt="產品圖片"
                    className="w-full h-full object-cover"
                />
                {allImages.length > 1 && (
                    <>
                        <button
                            className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => setActiveIndex(i => (i - 1 + allImages.length) % allImages.length)}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                            className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => setActiveIndex(i => (i + 1) % allImages.length)}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                            {allImages.map((_, i) => (
                                <div
                                    key={i}
                                    className={cn('h-1.5 rounded-full transition-all', i === activeIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/50')}
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>

            {allImages.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {allImages.map((img, i) => (
                        <div
                            key={img.id}
                            className={cn(
                                'w-14 h-14 flex-shrink-0 rounded overflow-hidden border-2 cursor-pointer transition-all',
                                i === activeIndex ? 'border-primary' : 'border-transparent hover:border-muted-foreground/40'
                            )}
                            onClick={() => setActiveIndex(i)}
                        >
                            <img src={img.url} alt="" className="w-full h-full object-cover" />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
