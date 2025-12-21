
-- 1. First drop ALL RLS policies that depend on old functions
DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Founders can view their store audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can manage all invitations" ON public.invitations;
DROP POLICY IF EXISTS "Anyone can view pending invitations by token" ON public.invitations;
DROP POLICY IF EXISTS "Store managers can manage their store invitations" ON public.invitations;
DROP POLICY IF EXISTS "Users can view invitations they sent" ON public.invitations;
DROP POLICY IF EXISTS "Admins can manage all notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Admins can manage all order items" ON public.order_items;
DROP POLICY IF EXISTS "Store members can create order items" ON public.order_items;
DROP POLICY IF EXISTS "Store members can view their order items" ON public.order_items;
DROP POLICY IF EXISTS "Admins can manage all orders" ON public.orders;
DROP POLICY IF EXISTS "Store members can create orders" ON public.orders;
DROP POLICY IF EXISTS "Store members can view their store orders" ON public.orders;
DROP POLICY IF EXISTS "Admins can manage products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can view active products" ON public.products;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage sales note items" ON public.sales_note_items;
DROP POLICY IF EXISTS "Store members can view their sales note items" ON public.sales_note_items;
DROP POLICY IF EXISTS "Admins can manage sales notes" ON public.sales_notes;
DROP POLICY IF EXISTS "Store founders and managers can update received status" ON public.sales_notes;
DROP POLICY IF EXISTS "Store members can view their sales notes" ON public.sales_notes;
DROP POLICY IF EXISTS "Admins can manage store products" ON public.store_products;
DROP POLICY IF EXISTS "Store members can view their store products" ON public.store_products;
DROP POLICY IF EXISTS "Admins can manage store users" ON public.store_users;
DROP POLICY IF EXISTS "Founders and managers can manage their store members" ON public.store_users;
DROP POLICY IF EXISTS "Members can view store members" ON public.store_users;
DROP POLICY IF EXISTS "Admins can manage stores" ON public.stores;
DROP POLICY IF EXISTS "Members can view their stores" ON public.stores;
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;

-- 2. Now drop old functions
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.get_store_role(uuid, uuid);

-- 3. Create new enums
CREATE TYPE public.system_role AS ENUM ('admin', 'customer');
CREATE TYPE public.store_role AS ENUM ('founder', 'manager', 'employee');
CREATE TYPE public.order_source_type AS ENUM ('frontend', 'admin_proxy');

-- 4. Add store_id to order_items
ALTER TABLE public.order_items ADD COLUMN store_id UUID;

-- 5. Replace created_by_admin with source_type
ALTER TABLE public.orders ADD COLUMN source_type public.order_source_type NOT NULL DEFAULT 'frontend';
UPDATE public.orders SET source_type = 'admin_proxy' WHERE created_by_admin = true;
ALTER TABLE public.orders DROP COLUMN created_by_admin;

-- 6. Drop defaults and convert user_roles
ALTER TABLE public.user_roles ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.user_roles ALTER COLUMN role TYPE public.system_role USING 
  CASE WHEN role::text = 'admin' THEN 'admin'::public.system_role ELSE 'customer'::public.system_role END;

-- 7. Drop defaults and convert store_users
ALTER TABLE public.store_users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.store_users ALTER COLUMN role TYPE public.store_role USING 
  CASE 
    WHEN role::text = 'founder' THEN 'founder'::public.store_role
    WHEN role::text = 'manager' THEN 'manager'::public.store_role
    ELSE 'employee'::public.store_role 
  END;
ALTER TABLE public.store_users ALTER COLUMN role SET DEFAULT 'employee'::public.store_role;

-- 8. Convert invitations role
ALTER TABLE public.invitations ALTER COLUMN role TYPE public.store_role USING 
  CASE 
    WHEN role::text = 'founder' THEN 'founder'::public.store_role
    WHEN role::text = 'manager' THEN 'manager'::public.store_role
    ELSE 'employee'::public.store_role 
  END;

-- 9. Update audit_logs columns
ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS performed_by_role;
ALTER TABLE public.audit_logs ADD COLUMN performed_by_system_role public.system_role;
ALTER TABLE public.audit_logs ADD COLUMN performed_by_store_role public.store_role;

-- 10. Drop old enum
DROP TYPE IF EXISTS public.app_role;

-- 11. Create new functions
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.system_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.get_store_role(_user_id uuid, _store_id uuid)
RETURNS public.store_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.store_users WHERE user_id = _user_id AND store_id = _store_id LIMIT 1 $$;

-- 12. Update handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'full_name');
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer'::public.system_role);
  RETURN NEW;
END;
$$;

-- 13. Create sales_notes shipped trigger
CREATE OR REPLACE FUNCTION public.handle_sales_note_shipped()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  item RECORD;
  new_shipped_qty INTEGER;
  new_status public.order_item_status;
BEGIN
  IF NEW.status = 'shipped' AND (OLD.status IS NULL OR OLD.status != 'shipped') THEN
    NEW.shipped_at = NOW();
    FOR item IN 
      SELECT sni.order_item_id, sni.quantity, oi.quantity as total_qty, oi.shipped_quantity as current_shipped
      FROM public.sales_note_items sni
      JOIN public.order_items oi ON oi.id = sni.order_item_id
      WHERE sni.sales_note_id = NEW.id
    LOOP
      new_shipped_qty := item.current_shipped + item.quantity;
      IF new_shipped_qty >= item.total_qty THEN new_status := 'shipped';
      ELSIF new_shipped_qty > 0 THEN new_status := 'partial';
      ELSE new_status := 'waiting';
      END IF;
      UPDATE public.order_items SET shipped_quantity = new_shipped_qty, status = new_status, updated_at = NOW() WHERE id = item.order_item_id;
      INSERT INTO public.audit_logs (entity_type, entity_id, action, performed_by, store_id, old_value, new_value)
      VALUES ('order_item', item.order_item_id, 'shipped_quantity_updated', NEW.created_by, NEW.store_id,
        jsonb_build_object('shipped_quantity', item.current_shipped),
        jsonb_build_object('shipped_quantity', new_shipped_qty, 'status', new_status::text));
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_sales_note_shipped ON public.sales_notes;
CREATE TRIGGER on_sales_note_shipped BEFORE UPDATE ON public.sales_notes FOR EACH ROW EXECUTE FUNCTION public.handle_sales_note_shipped();

-- 14. Populate and constrain store_id on order_items
UPDATE public.order_items oi SET store_id = o.store_id FROM public.orders o WHERE oi.order_id = o.id;
ALTER TABLE public.order_items ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.order_items ADD CONSTRAINT fk_order_items_store FOREIGN KEY (store_id) REFERENCES public.stores(id);

-- 15. Recreate all RLS policies
CREATE POLICY "Admins can view all audit logs" ON public.audit_logs FOR SELECT USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Founders can view their store audit logs" ON public.audit_logs FOR SELECT USING (store_id IS NOT NULL AND get_store_role(auth.uid(), store_id) = 'founder');
CREATE POLICY "System can insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK (auth.uid() = performed_by);

CREATE POLICY "Admins can manage all invitations" ON public.invitations FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone can view pending invitations by token" ON public.invitations FOR SELECT USING (status = 'pending');
CREATE POLICY "Store managers can manage their store invitations" ON public.invitations FOR ALL USING (store_id IS NOT NULL AND get_store_role(auth.uid(), store_id) IN ('founder', 'manager'));
CREATE POLICY "Users can view invitations they sent" ON public.invitations FOR SELECT USING (auth.uid() = invited_by);

CREATE POLICY "Admins can manage all notifications" ON public.notifications FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all order items" ON public.order_items FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Store members can view their order items" ON public.order_items FOR SELECT USING (has_role(auth.uid(), 'admin') OR is_store_member(auth.uid(), store_id));
CREATE POLICY "Store members can create order items" ON public.order_items FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR (is_store_member(auth.uid(), store_id) AND get_store_role(auth.uid(), store_id) IS NOT NULL));

CREATE POLICY "Admins can manage all orders" ON public.orders FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Store members can view their store orders" ON public.orders FOR SELECT USING (has_role(auth.uid(), 'admin') OR is_store_member(auth.uid(), store_id));
CREATE POLICY "Store members can create orders" ON public.orders FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') OR (is_store_member(auth.uid(), store_id) AND get_store_role(auth.uid(), store_id) IS NOT NULL));

CREATE POLICY "Admins can manage products" ON public.products FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated users can view active products" ON public.products FOR SELECT USING (status = 'active' OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can manage sales note items" ON public.sales_note_items FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Store members can view their sales note items" ON public.sales_note_items FOR SELECT USING (EXISTS (SELECT 1 FROM public.sales_notes sn WHERE sn.id = sales_note_items.sales_note_id AND (has_role(auth.uid(), 'admin') OR is_store_member(auth.uid(), sn.store_id))));

CREATE POLICY "Admins can manage sales notes" ON public.sales_notes FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Store members can view their sales notes" ON public.sales_notes FOR SELECT USING (has_role(auth.uid(), 'admin') OR is_store_member(auth.uid(), store_id));
CREATE POLICY "Store founders and managers can update received status" ON public.sales_notes FOR UPDATE USING (get_store_role(auth.uid(), store_id) IN ('founder', 'manager'));

CREATE POLICY "Admins can manage store products" ON public.store_products FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Store members can view their store products" ON public.store_products FOR SELECT USING (has_role(auth.uid(), 'admin') OR is_store_member(auth.uid(), store_id));

CREATE POLICY "Admins can manage store users" ON public.store_users FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Founders and managers can manage their store members" ON public.store_users FOR ALL USING (get_store_role(auth.uid(), store_id) IN ('founder', 'manager'));
CREATE POLICY "Members can view store members" ON public.store_users FOR SELECT USING (has_role(auth.uid(), 'admin') OR is_store_member(auth.uid(), store_id));

CREATE POLICY "Admins can manage stores" ON public.stores FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Members can view their stores" ON public.stores FOR SELECT USING (has_role(auth.uid(), 'admin') OR is_store_member(auth.uid(), id));

CREATE POLICY "Admins can manage all roles" ON public.user_roles FOR ALL USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
