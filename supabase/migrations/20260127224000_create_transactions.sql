-- Create a new table for caching financial transactions
create table public.transactions (
    id uuid not null default gen_random_uuid(),
    created_at timestamp with time zone not null default now(),
    created_by uuid references auth.users(id),
    
    date date not null default current_date,
    type text not null check (type in ('income', 'expense')),
    category text not null, -- 'store_payment', 'vendor_payment', 'salary', 'rent', 'other'
    amount numeric not null default 0,
    status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
    description text,
    
    -- Optional links
    store_id uuid references public.stores(id),
    vendor_name text,
    payment_method text, -- 'cash', 'transfer', 'check'

    constraint transactions_pkey primary key (id)
);

-- Enable RLS
alter table public.transactions enable row level security;

-- Create policies (Allow Admins and Founders)
create policy "Admins can view all transactions"
    on public.transactions for select
    using ( 
        exists (
          select 1 from public.user_roles ur 
          where ur.user_id = auth.uid() 
          and ur.role = 'admin'
        )
        or 
        exists (
          select 1 from public.store_users su 
          where su.user_id = auth.uid() 
          and su.role = 'founder'
        )
    );

create policy "Admins can insert transactions"
    on public.transactions for insert
    with check (
        exists (
          select 1 from public.user_roles ur 
          where ur.user_id = auth.uid() 
          and ur.role = 'admin'
        )
        or 
        exists (
          select 1 from public.store_users su 
          where su.user_id = auth.uid() 
          and su.role = 'founder'
        )
    );

create policy "Admins can update transactions"
    on public.transactions for update
    using (
        exists (
          select 1 from public.user_roles ur 
          where ur.user_id = auth.uid() 
          and ur.role = 'admin'
        )
        or 
        exists (
          select 1 from public.store_users su 
          where su.user_id = auth.uid() 
          and su.role = 'founder'
        )
    );

create policy "Admins can delete transactions"
    on public.transactions for delete
    using (
        exists (
          select 1 from public.user_roles ur 
          where ur.user_id = auth.uid() 
          and ur.role = 'admin'
        )
        or 
        exists (
          select 1 from public.store_users su 
          where su.user_id = auth.uid() 
          and su.role = 'founder'
        )
    );
