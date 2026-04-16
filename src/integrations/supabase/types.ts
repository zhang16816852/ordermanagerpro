export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accounting_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          type: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          type?: string
        }
        Relationships: []
      }
      accounting_entries: {
        Row: {
          account_id: string | null
          amount: number
          category_id: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          paid_amount: number
          payment_status: Database["public"]["Enums"]["payment_status"]
          reference_id: string | null
          reference_type: string | null
          transaction_date: string
          type: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          paid_amount?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          reference_id?: string | null
          reference_type?: string | null
          transaction_date?: string
          type: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          paid_amount?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          reference_id?: string | null
          reference_type?: string | null
          transaction_date?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "accounting_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          balance: number
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          new_value: Json | null
          old_value: Json | null
          performed_by: string
          performed_by_store_role:
            | Database["public"]["Enums"]["store_role"]
            | null
          performed_by_system_role:
            | Database["public"]["Enums"]["system_role"]
            | null
          store_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          performed_by: string
          performed_by_store_role?:
            | Database["public"]["Enums"]["store_role"]
            | null
          performed_by_system_role?:
            | Database["public"]["Enums"]["system_role"]
            | null
          store_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          performed_by?: string
          performed_by_store_role?:
            | Database["public"]["Enums"]["store_role"]
            | null
          performed_by_system_role?:
            | Database["public"]["Enums"]["system_role"]
            | null
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number | null
          spec_schema: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number | null
          spec_schema?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number | null
          spec_schema?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_hierarchy: {
        Row: {
          child_id: string
          parent_id: string
        }
        Insert: {
          child_id: string
          parent_id: string
        }
        Update: {
          child_id?: string
          parent_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_hierarchy_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_hierarchy_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_spec_links: {
        Row: {
          category_id: string
          sort_order: number | null
          spec_id: string
        }
        Insert: {
          category_id: string
          sort_order?: number | null
          spec_id: string
        }
        Update: {
          category_id?: string
          sort_order?: number | null
          spec_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_spec_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_spec_links_spec_id_fkey"
            columns: ["spec_id"]
            isOneToOne: false
            referencedRelation: "specification_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      data_versions: {
        Row: {
          table_name: string
          updated_at: string
          version: number
        }
        Insert: {
          table_name: string
          updated_at?: string
          version?: number
        }
        Update: {
          table_name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      device_brands: {
        Row: {
          created_at: string | null
          id: string
          name: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      device_models: {
        Row: {
          brand_id: string | null
          created_at: string | null
          device_remarks: string | null
          device_series: string | null
          device_type: string | null
          id: string
          is_active: boolean | null
          name: string
          release_date: string | null
          screen_size: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          brand_id?: string | null
          created_at?: string | null
          device_remarks?: string | null
          device_series?: string | null
          device_type?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          release_date?: string | null
          screen_size?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          brand_id?: string | null
          created_at?: string | null
          device_remarks?: string | null
          device_series?: string | null
          device_type?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          release_date?: string | null
          screen_size?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_models_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "device_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["store_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          store_id: string | null
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["store_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          store_id?: string | null
          token?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["store_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          store_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          link: string | null
          message: string
          read: boolean
          store_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          message: string
          read?: boolean
          store_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          message?: string
          read?: boolean
          store_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string
          quantity: number
          shipped_quantity: number
          status: Database["public"]["Enums"]["order_item_status"]
          store_id: string
          unit_price: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          quantity?: number
          shipped_quantity?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          store_id: string
          unit_price: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          shipped_quantity?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          store_id?: string
          unit_price?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_order_items_store"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          access_token: string | null
          code: string | null
          created_at: string
          created_by: string
          id: string
          notes: string | null
          source_type: Database["public"]["Enums"]["order_source_type"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          code?: string | null
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          source_type?: Database["public"]["Enums"]["order_source_type"]
          status?: Database["public"]["Enums"]["order_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          code?: string | null
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          source_type?: Database["public"]["Enums"]["order_source_type"]
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_category_links: {
        Row: {
          category_id: string
          product_id: string
        }
        Insert: {
          category_id: string
          product_id: string
        }
        Update: {
          category_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_category_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_category_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_inventory: {
        Row: {
          id: string
          product_id: string | null
          quantity: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          id?: string
          product_id?: string | null
          quantity?: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          id?: string
          product_id?: string | null
          quantity?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_model_links: {
        Row: {
          created_at: string | null
          model_id: string
          product_id: string
        }
        Insert: {
          created_at?: string | null
          model_id: string
          product_id: string
        }
        Update: {
          created_at?: string | null
          model_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_model_links_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "device_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_model_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          color: string | null
          created_at: string
          id: string
          name: string
          option_1: string | null
          option_2: string | null
          option_3: string | null
          product_id: string
          retail_price: number
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          table_settings: Json | null
          updated_at: string
          wholesale_price: number
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          created_at?: string
          id?: string
          name: string
          option_1?: string | null
          option_2?: string | null
          option_3?: string | null
          product_id: string
          retail_price?: number
          sku: string
          status?: Database["public"]["Enums"]["product_status"]
          table_settings?: Json | null
          updated_at?: string
          wholesale_price?: number
        }
        Update: {
          barcode?: string | null
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          option_1?: string | null
          option_2?: string | null
          option_3?: string | null
          product_id?: string
          retail_price?: number
          sku?: string
          status?: Database["public"]["Enums"]["product_status"]
          table_settings?: Json | null
          updated_at?: string
          wholesale_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          base_retail_price: number
          base_wholesale_price: number
          brand_id: string | null
          color: string | null
          created_at: string
          description: string | null
          has_variants: boolean | null
          id: string
          model: string | null
          name: string
          series: string | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          table_settings: Json | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          base_retail_price?: number
          base_wholesale_price?: number
          brand_id?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          has_variants?: boolean | null
          id?: string
          model?: string | null
          name: string
          series?: string | null
          sku: string
          status?: Database["public"]["Enums"]["product_status"]
          table_settings?: Json | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          base_retail_price?: number
          base_wholesale_price?: number
          brand_id?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          has_variants?: boolean | null
          id?: string
          model?: string | null
          name?: string
          series?: string | null
          sku?: string
          status?: Database["public"]["Enums"]["product_status"]
          table_settings?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          created_at: string
          id: string
          product_id: string | null
          purchase_order_id: string
          quantity: number
          received_quantity: number
          unit_cost: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id?: string | null
          purchase_order_id: string
          quantity?: number
          received_quantity?: number
          unit_cost?: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string | null
          purchase_order_id?: string
          quantity?: number
          received_quantity?: number
          unit_cost?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string
          expected_date: string | null
          id: string
          notes: string | null
          order_date: string
          received_date: string | null
          status: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          received_date?: string | null
          status?: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          received_date?: string | null
          status?: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_note_items: {
        Row: {
          created_at: string
          id: string
          order_item_id: string
          quantity: number
          sales_note_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_item_id: string
          quantity: number
          sales_note_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_item_id?: string
          quantity?: number
          sales_note_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_note_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_note_items_sales_note_id_fkey"
            columns: ["sales_note_id"]
            isOneToOne: false
            referencedRelation: "sales_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_notes: {
        Row: {
          access_token: string | null
          code: string | null
          created_at: string
          created_by: string
          id: string
          notes: string | null
          received_at: string | null
          received_by: string | null
          shipped_at: string | null
          status: Database["public"]["Enums"]["sales_note_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          code?: string | null
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          received_at?: string | null
          received_by?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["sales_note_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          code?: string | null
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          received_at?: string | null
          received_by?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["sales_note_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_notes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_pool: {
        Row: {
          created_at: string
          created_by: string
          id: string
          order_item_id: string
          quantity: number
          store_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          order_item_id: string
          quantity: number
          store_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          order_item_id?: string
          quantity?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_pool_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_pool_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      specification_definitions: {
        Row: {
          created_at: string | null
          default_value: string | null
          id: string
          logic_config: Json | null
          name: string
          options: Json | null
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_value?: string | null
          id?: string
          logic_config?: Json | null
          name: string
          options?: Json | null
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_value?: string | null
          id?: string
          logic_config?: Json | null
          name?: string
          options?: Json | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      store_products: {
        Row: {
          brand: string | null
          created_at: string
          id: string
          product_id: string
          retail_price: number | null
          updated_at: string
          variant_id: string | null
          wholesale_price: number | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          id?: string
          product_id: string
          retail_price?: number | null
          updated_at?: string
          variant_id?: string | null
          wholesale_price?: number | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          id?: string
          product_id?: string
          retail_price?: number | null
          updated_at?: string
          variant_id?: string | null
          wholesale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "store_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_products_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      store_users: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["store_role"]
          store_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["store_role"]
          store_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["store_role"]
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_users_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          brand: string | null
          code: string | null
          created_at: string
          id: string
          name: string
          owner_id: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          brand?: string | null
          code?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          brand?: string | null
          code?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      supplier_import_configs: {
        Row: {
          created_at: string | null
          header_row: number | null
          id: string
          mapping_config: Json
          supplier_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          header_row?: number | null
          id?: string
          mapping_config: Json
          supplier_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          header_row?: number | null
          id?: string
          mapping_config?: Json
          supplier_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_import_configs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: true
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_product_mappings: {
        Row: {
          created_at: string | null
          id: string
          internal_product_id: string
          internal_variant_id: string | null
          supplier_id: string
          updated_at: string | null
          vendor_product_id: string
          vendor_product_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          internal_product_id: string
          internal_variant_id?: string | null
          supplier_id: string
          updated_at?: string | null
          vendor_product_id: string
          vendor_product_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          internal_product_id?: string
          internal_variant_id?: string | null
          supplier_id?: string
          updated_at?: string | null
          vendor_product_id?: string
          vendor_product_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_product_mappings_internal_product_id_fkey"
            columns: ["internal_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_product_mappings_internal_variant_id_fkey"
            columns: ["internal_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_product_mappings_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_sequences: {
        Row: {
          current_value: number
          name: string
          updated_at: string
        }
        Insert: {
          current_value?: number
          name: string
          updated_at?: string
        }
        Update: {
          current_value?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["system_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["system_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["system_role"]
          user_id?: string
        }
        Relationships: []
      }
      variant_model_links: {
        Row: {
          created_at: string | null
          id: string
          model_id: string
          variant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          model_id: string
          variant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          model_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_model_links_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "device_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_model_links_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_sales_note: {
        Args: { p_sales_note_id: string }
        Returns: undefined
      }
      duplicate_product_with_variants: {
        Args: { new_name: string; new_sku: string; target_product_id: string }
        Returns: string
      }
      get_shared_order_details: {
        Args: { p_identifier: string; p_token: string }
        Returns: Json
      }
      get_shared_sales_note_details: {
        Args: { p_identifier: string; p_token: string }
        Returns: Json
      }
      get_store_role: {
        Args: { _store_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["store_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["system_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_store_member: {
        Args: { _store_id: string; _user_id: string }
        Returns: boolean
      }
      upsert_brand_product_prices: {
        Args: { p_brand: string; p_products: Json }
        Returns: undefined
      }
      upsert_store_products_batch: {
        Args: { p_items: Json }
        Returns: undefined
      }
    }
    Enums: {
      invitation_status: "pending" | "accepted" | "expired"
      order_item_status:
        | "waiting"
        | "partial"
        | "shipped"
        | "out_of_stock"
        | "discontinued"
        | "cancelled"
      order_source_type: "frontend" | "admin_proxy"
      order_status: "pending" | "processing" | "shipped"
      payment_status: "unpaid" | "partial" | "paid"
      product_status: "active" | "discontinued" | "preorder" | "sold_out"
      purchase_order_status:
        | "draft"
        | "ordered"
        | "partial_received"
        | "received"
        | "cancelled"
      sales_note_status: "draft" | "shipped" | "received"
      store_role: "founder" | "manager" | "employee"
      system_role: "admin" | "customer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      invitation_status: ["pending", "accepted", "expired"],
      order_item_status: [
        "waiting",
        "partial",
        "shipped",
        "out_of_stock",
        "discontinued",
        "cancelled",
      ],
      order_source_type: ["frontend", "admin_proxy"],
      order_status: ["pending", "processing", "shipped"],
      payment_status: ["unpaid", "partial", "paid"],
      product_status: ["active", "discontinued", "preorder", "sold_out"],
      purchase_order_status: [
        "draft",
        "ordered",
        "partial_received",
        "received",
        "cancelled",
      ],
      sales_note_status: ["draft", "shipped", "received"],
      store_role: ["founder", "manager", "employee"],
      system_role: ["admin", "customer"],
    },
  },
} as const
