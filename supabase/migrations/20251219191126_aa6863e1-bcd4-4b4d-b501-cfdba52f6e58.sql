-- Create enum for app roles
CREATE TYPE public.app_role AS ENUM ('admin', 'founder', 'manager', 'employee', 'customer');

-- Create enum for product status
CREATE TYPE public.product_status AS ENUM ('active', 'discontinued');

-- Create enum for order item status
CREATE TYPE public.order_item_status AS ENUM ('waiting', 'partial', 'shipped', 'out_of_stock', 'discontinued');

-- Create enum for sales note status
CREATE TYPE public.sales_note_status AS ENUM ('draft', 'shipped', 'received');

-- Create enum for invitation status
CREATE TYPE public.invitation_status AS ENUM ('pending', 'accepted', 'expired');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Create stores table
CREATE TABLE public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  address TEXT,
  phone TEXT,
  owner_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create store_users table (many-to-many relationship)
CREATE TABLE public.store_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'employee',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, user_id)
);

-- Create products table (system-wide catalog)
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT UNIQUE NOT NULL,
  description TEXT,
  base_retail_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  base_wholesale_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  status product_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create store_products table (store-specific pricing)
CREATE TABLE public.store_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  retail_price DECIMAL(10,2),
  wholesale_price DECIMAL(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, product_id)
);

-- Create orders table (container only)
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_by_admin BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create order_items table with status machine
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  shipped_quantity INTEGER NOT NULL DEFAULT 0,
  status order_item_status NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create sales_notes table
CREATE TABLE public.sales_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  status sales_note_status NOT NULL DEFAULT 'draft',
  notes TEXT,
  shipped_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  received_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create sales_note_items table
CREATE TABLE public.sales_note_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_note_id UUID NOT NULL REFERENCES public.sales_notes(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES public.order_items(id),
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create audit_logs table
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  performed_by UUID NOT NULL REFERENCES auth.users(id),
  performed_by_role app_role,
  store_id UUID REFERENCES public.stores(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create invitations table
CREATE TABLE public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  status invitation_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_note_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Create security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to check store membership
CREATE OR REPLACE FUNCTION public.is_store_member(_user_id UUID, _store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_users
    WHERE user_id = _user_id
      AND store_id = _store_id
  )
$$;

-- Create function to get user's store role
CREATE OR REPLACE FUNCTION public.get_store_role(_user_id UUID, _store_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.store_users
  WHERE user_id = _user_id
    AND store_id = _store_id
  LIMIT 1
$$;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for user_roles
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for stores
CREATE POLICY "Members can view their stores" ON public.stores
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin') OR
    public.is_store_member(auth.uid(), id)
  );

CREATE POLICY "Admins can manage stores" ON public.stores
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for store_users
CREATE POLICY "Members can view store members" ON public.store_users
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin') OR
    public.is_store_member(auth.uid(), store_id)
  );

CREATE POLICY "Admins can manage store users" ON public.store_users
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Founders and managers can manage their store members" ON public.store_users
  FOR ALL USING (
    public.get_store_role(auth.uid(), store_id) IN ('founder', 'manager')
  );

-- RLS Policies for products (system-wide catalog)
CREATE POLICY "Authenticated users can view active products" ON public.products
  FOR SELECT TO authenticated USING (status = 'active' OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage products" ON public.products
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for store_products
CREATE POLICY "Store members can view their store products" ON public.store_products
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin') OR
    public.is_store_member(auth.uid(), store_id)
  );

CREATE POLICY "Admins can manage store products" ON public.store_products
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for orders
CREATE POLICY "Store members can view their store orders" ON public.orders
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin') OR
    public.is_store_member(auth.uid(), store_id)
  );

CREATE POLICY "Store members can create orders" ON public.orders
  FOR INSERT WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR
    (public.is_store_member(auth.uid(), store_id) AND 
     public.get_store_role(auth.uid(), store_id) IN ('founder', 'manager', 'employee'))
  );

CREATE POLICY "Admins can manage all orders" ON public.orders
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for order_items
CREATE POLICY "Store members can view their order items" ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
      AND (public.has_role(auth.uid(), 'admin') OR public.is_store_member(auth.uid(), o.store_id))
    )
  );

CREATE POLICY "Store members can create order items" ON public.order_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
      AND (public.has_role(auth.uid(), 'admin') OR 
           (public.is_store_member(auth.uid(), o.store_id) AND 
            public.get_store_role(auth.uid(), o.store_id) IN ('founder', 'manager', 'employee')))
    )
  );

CREATE POLICY "Admins can manage all order items" ON public.order_items
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for sales_notes
CREATE POLICY "Store members can view their sales notes" ON public.sales_notes
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin') OR
    public.is_store_member(auth.uid(), store_id)
  );

CREATE POLICY "Admins can manage sales notes" ON public.sales_notes
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Store founders and managers can update received status" ON public.sales_notes
  FOR UPDATE USING (
    public.get_store_role(auth.uid(), store_id) IN ('founder', 'manager')
  );

-- RLS Policies for sales_note_items
CREATE POLICY "Store members can view their sales note items" ON public.sales_note_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sales_notes sn
      WHERE sn.id = sales_note_id
      AND (public.has_role(auth.uid(), 'admin') OR public.is_store_member(auth.uid(), sn.store_id))
    )
  );

CREATE POLICY "Admins can manage sales note items" ON public.sales_note_items
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for audit_logs
CREATE POLICY "Admins can view all audit logs" ON public.audit_logs
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Founders can view their store audit logs" ON public.audit_logs
  FOR SELECT USING (
    store_id IS NOT NULL AND
    public.get_store_role(auth.uid(), store_id) = 'founder'
  );

CREATE POLICY "System can insert audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (auth.uid() = performed_by);

-- RLS Policies for notifications
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all notifications" ON public.notifications
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for invitations
CREATE POLICY "Users can view invitations they sent" ON public.invitations
  FOR SELECT USING (auth.uid() = invited_by);

CREATE POLICY "Admins can manage all invitations" ON public.invitations
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Store managers can manage their store invitations" ON public.invitations
  FOR ALL USING (
    store_id IS NOT NULL AND
    public.get_store_role(auth.uid(), store_id) IN ('founder', 'manager')
  );

CREATE POLICY "Anyone can view pending invitations by token" ON public.invitations
  FOR SELECT USING (status = 'pending');

-- Create trigger function for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_store_products_updated_at BEFORE UPDATE ON public.store_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_order_items_updated_at BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sales_notes_updated_at BEFORE UPDATE ON public.sales_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert profile
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'full_name');
  
  -- Self-registered users get 'customer' role by default
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer');
  
  RETURN NEW;
END;
$$;

-- Create trigger for new user registration
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();