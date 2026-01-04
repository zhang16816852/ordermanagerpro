-- 建立獨立出貨池資料表
CREATE TABLE public.shipping_pool (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  store_id UUID NOT NULL REFERENCES public.stores(id),
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 為出貨池建立唯一約束，防止同一訂單項目重複加入
CREATE UNIQUE INDEX idx_shipping_pool_order_item ON public.shipping_pool(order_item_id);

-- 啟用 RLS
ALTER TABLE public.shipping_pool ENABLE ROW LEVEL SECURITY;

-- RLS 政策：管理員可以管理所有出貨池
CREATE POLICY "Admins can manage shipping pool"
ON public.shipping_pool
FOR ALL
USING (has_role(auth.uid(), 'admin'::system_role));

-- RLS 政策：店家成員可以查看自己店家的出貨池
CREATE POLICY "Store members can view their shipping pool"
ON public.shipping_pool
FOR SELECT
USING (is_store_member(auth.uid(), store_id));