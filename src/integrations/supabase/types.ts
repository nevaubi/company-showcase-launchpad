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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_cache: {
        Row: {
          created_at: string
          key: string
          payload: Json
        }
        Insert: {
          created_at?: string
          key: string
          payload: Json
        }
        Update: {
          created_at?: string
          key?: string
          payload?: Json
        }
        Relationships: []
      }
      alt_data: {
        Row: {
          created_at: string
          dataset: string
          date: string | null
          kind: string
          meta: Json
          source: string
          source_url: string | null
          ticker: string
          title: string
          uid: string
          unit: string | null
          value: number | null
        }
        Insert: {
          created_at?: string
          dataset: string
          date?: string | null
          kind?: string
          meta?: Json
          source: string
          source_url?: string | null
          ticker: string
          title: string
          uid: string
          unit?: string | null
          value?: number | null
        }
        Update: {
          created_at?: string
          dataset?: string
          date?: string | null
          kind?: string
          meta?: Json
          source?: string
          source_url?: string | null
          ticker?: string
          title?: string
          uid?: string
          unit?: string | null
          value?: number | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          content: Json
          created_at: string
          id: string
          kind: string
          ticker: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: Json
          created_at?: string
          id?: string
          kind: string
          ticker?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          kind?: string
          ticker?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      filing_documents: {
        Row: {
          accn: string
          bytes: number
          cached_at: string
          content_type: string
          doc: string
          path: string
        }
        Insert: {
          accn: string
          bytes: number
          cached_at?: string
          content_type: string
          doc: string
          path: string
        }
        Update: {
          accn?: string
          bytes?: number
          cached_at?: string
          content_type?: string
          doc?: string
          path?: string
        }
        Relationships: []
      }
      insider_trades: {
        Row: {
          accn: string
          acquired: boolean
          code: string
          direct: boolean
          discovered_at: string
          doc: string
          filed: string
          owned_after: number | null
          owner: string
          plan_10b5: boolean
          price: number | null
          role: string
          security: string
          seq: number
          shares: number
          ticker: string
          trade_date: string
        }
        Insert: {
          accn: string
          acquired: boolean
          code: string
          direct: boolean
          discovered_at?: string
          doc: string
          filed: string
          owned_after?: number | null
          owner: string
          plan_10b5?: boolean
          price?: number | null
          role: string
          security: string
          seq: number
          shares: number
          ticker: string
          trade_date: string
        }
        Update: {
          accn?: string
          acquired?: boolean
          code?: string
          direct?: boolean
          discovered_at?: string
          doc?: string
          filed?: string
          owned_after?: number | null
          owner?: string
          plan_10b5?: boolean
          price?: number | null
          role?: string
          security?: string
          seq?: number
          shares?: number
          ticker?: string
          trade_date?: string
        }
        Relationships: []
      }
      ir_company_series: {
        Row: {
          built_at: string
          payload: Json | null
          payload_bytes: number | null
          payload_path: string | null
          stats: Json
          ticker: string
        }
        Insert: {
          built_at?: string
          payload?: Json | null
          payload_bytes?: number | null
          payload_path?: string | null
          stats?: Json
          ticker: string
        }
        Update: {
          built_at?: string
          payload?: Json | null
          payload_bytes?: number | null
          payload_path?: string | null
          stats?: Json
          ticker?: string
        }
        Relationships: []
      }
      ir_documents: {
        Row: {
          accn: string | null
          bytes: number | null
          content_type: string | null
          exhibit: string | null
          ext: string | null
          extract_facts: number | null
          extract_model: string | null
          extract_status: string | null
          extract_usage: Json | null
          extracted_at: string | null
          fetched_at: string
          filed: string | null
          id: string
          kind: string
          pages: number | null
          path: string | null
          period: string | null
          rendition_path: string | null
          sha256: string | null
          source: string
          source_url: string
          ticker: string
          title: string
          vision_at: string | null
          vision_status: string | null
        }
        Insert: {
          accn?: string | null
          bytes?: number | null
          content_type?: string | null
          exhibit?: string | null
          ext?: string | null
          extract_facts?: number | null
          extract_model?: string | null
          extract_status?: string | null
          extract_usage?: Json | null
          extracted_at?: string | null
          fetched_at?: string
          filed?: string | null
          id?: string
          kind?: string
          pages?: number | null
          path?: string | null
          period?: string | null
          rendition_path?: string | null
          sha256?: string | null
          source?: string
          source_url: string
          ticker: string
          title?: string
          vision_at?: string | null
          vision_status?: string | null
        }
        Update: {
          accn?: string | null
          bytes?: number | null
          content_type?: string | null
          exhibit?: string | null
          ext?: string | null
          extract_facts?: number | null
          extract_model?: string | null
          extract_status?: string | null
          extract_usage?: Json | null
          extracted_at?: string | null
          fetched_at?: string
          filed?: string | null
          id?: string
          kind?: string
          pages?: number | null
          path?: string | null
          period?: string | null
          rendition_path?: string | null
          sha256?: string | null
          source?: string
          source_url?: string
          ticker?: string
          title?: string
          vision_at?: string | null
          vision_status?: string | null
        }
        Relationships: []
      }
      ir_kpi_facts: {
        Row: {
          accn: string | null
          breakdown: string | null
          category: string
          created_at: string
          derived: boolean
          doc: string | null
          document_id: string
          document_kind: string | null
          filed: string | null
          id: string
          is_total: boolean
          label: string
          locator: Json
          method: string
          metric: string
          model: string | null
          months: number | null
          parent: string | null
          period_end: string | null
          period_label: string
          period_start: string | null
          ticker: string
          unit: string
          value: number
        }
        Insert: {
          accn?: string | null
          breakdown?: string | null
          category: string
          created_at?: string
          derived?: boolean
          doc?: string | null
          document_id: string
          document_kind?: string | null
          filed?: string | null
          id?: string
          is_total?: boolean
          label: string
          locator?: Json
          method?: string
          metric?: string
          model?: string | null
          months?: number | null
          parent?: string | null
          period_end?: string | null
          period_label: string
          period_start?: string | null
          ticker: string
          unit?: string
          value: number
        }
        Update: {
          accn?: string | null
          breakdown?: string | null
          category?: string
          created_at?: string
          derived?: boolean
          doc?: string | null
          document_id?: string
          document_kind?: string | null
          filed?: string | null
          id?: string
          is_total?: boolean
          label?: string
          locator?: Json
          method?: string
          metric?: string
          model?: string | null
          months?: number | null
          parent?: string | null
          period_end?: string | null
          period_label?: string
          period_start?: string | null
          ticker?: string
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "ir_kpi_facts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "ir_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      ir_label_map: {
        Row: {
          canonical: Json
          created_at: string
          model: string | null
          raw_key: string
          ticker: string
        }
        Insert: {
          canonical: Json
          created_at?: string
          model?: string | null
          raw_key: string
          ticker: string
        }
        Update: {
          canonical?: Json
          created_at?: string
          model?: string | null
          raw_key?: string
          ticker?: string
        }
        Relationships: []
      }
      ir_release_scan: {
        Row: {
          accn: string
          files: number
          scanned_at: string
          status: string
          stored: number
          ticker: string
        }
        Insert: {
          accn: string
          files?: number
          scanned_at?: string
          status: string
          stored?: number
          ticker: string
        }
        Update: {
          accn?: string
          files?: number
          scanned_at?: string
          status?: string
          stored?: number
          ticker?: string
        }
        Relationships: []
      }
      job_runs: {
        Row: {
          detail: Json | null
          finished_at: string | null
          id: number
          items: number
          job: string
          ok: boolean | null
          started_at: string
        }
        Insert: {
          detail?: Json | null
          finished_at?: string | null
          id?: never
          items?: number
          job: string
          ok?: boolean | null
          started_at?: string
        }
        Update: {
          detail?: Json | null
          finished_at?: string | null
          id?: never
          items?: number
          job?: string
          ok?: boolean | null
          started_at?: string
        }
        Relationships: []
      }
      job_state: {
        Row: {
          cursor: number
          job: string
          lease_until: string | null
          paused_reason: string | null
          updated_at: string
        }
        Insert: {
          cursor?: number
          job: string
          lease_until?: string | null
          paused_reason?: string | null
          updated_at?: string
        }
        Update: {
          cursor?: number
          job?: string
          lease_until?: string | null
          paused_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      macro_observations: {
        Row: {
          date: string
          series_id: string
          updated_at: string
          value: number
        }
        Insert: {
          date: string
          series_id: string
          updated_at?: string
          value: number
        }
        Update: {
          date?: string
          series_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      macro_summaries: {
        Row: {
          series_id: string
          summary: Json
          updated_at: string
        }
        Insert: {
          series_id: string
          summary: Json
          updated_at?: string
        }
        Update: {
          series_id?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: []
      }
      market_bars: {
        Row: {
          adj_close: number | null
          close: number
          date: string
          high: number | null
          low: number | null
          open: number | null
          symbol: string
          updated_at: string
          volume: number | null
        }
        Insert: {
          adj_close?: number | null
          close: number
          date: string
          high?: number | null
          low?: number | null
          open?: number | null
          symbol: string
          updated_at?: string
          volume?: number | null
        }
        Update: {
          adj_close?: number | null
          close?: number
          date?: string
          high?: number | null
          low?: number | null
          open?: number | null
          symbol?: string
          updated_at?: string
          volume?: number | null
        }
        Relationships: []
      }
      paper_trades: {
        Row: {
          closed_at: string | null
          closed_price: number | null
          created_at: string
          direction: string
          entry_date: string
          entry_price: number
          id: string
          signals: Json
          stop: number | null
          target: number | null
          ticker: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_price?: number | null
          created_at?: string
          direction: string
          entry_date?: string
          entry_price: number
          id?: string
          signals?: Json
          stop?: number | null
          target?: number | null
          ticker: string
          user_id?: string
        }
        Update: {
          closed_at?: string | null
          closed_price?: number | null
          created_at?: string
          direction?: string
          entry_date?: string
          entry_price?: number
          id?: string
          signals?: Json
          stop?: number | null
          target?: number | null
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_demo: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_demo?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_demo?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      research_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          steps: Json
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          role: string
          session_id: string
          steps?: Json
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          steps?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "research_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      research_sessions: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sec_filings: {
        Row: {
          accn: string
          cik: string
          description: string | null
          discovered_at: string
          doc: string
          filed: string
          form: string
          items: string | null
          ixbrl: boolean
          report: string | null
          size: number | null
          ticker: string
        }
        Insert: {
          accn: string
          cik: string
          description?: string | null
          discovered_at?: string
          doc: string
          filed: string
          form: string
          items?: string | null
          ixbrl?: boolean
          report?: string | null
          size?: number | null
          ticker: string
        }
        Update: {
          accn?: string
          cik?: string
          description?: string | null
          discovered_at?: string
          doc?: string
          filed?: string
          form?: string
          items?: string | null
          ixbrl?: boolean
          report?: string | null
          size?: number | null
          ticker?: string
        }
        Relationships: []
      }
      supply_links: {
        Row: {
          accn: string
          amount_usd: number | null
          counterparty: string
          counterparty_domain: string | null
          counterparty_ticker: string | null
          created_at: string
          detail: string
          doc: string
          filed: string
          form: string
          id: string
          is_current: boolean
          link_type: string | null
          product: string | null
          quote: string
          regions: string[]
          relation: string
          risk: string | null
          share_pct: number | null
          single_source: boolean
          ticker: string
        }
        Insert: {
          accn: string
          amount_usd?: number | null
          counterparty: string
          counterparty_domain?: string | null
          counterparty_ticker?: string | null
          created_at?: string
          detail: string
          doc: string
          filed: string
          form: string
          id?: string
          is_current?: boolean
          link_type?: string | null
          product?: string | null
          quote: string
          regions?: string[]
          relation: string
          risk?: string | null
          share_pct?: number | null
          single_source?: boolean
          ticker: string
        }
        Update: {
          accn?: string
          amount_usd?: number | null
          counterparty?: string
          counterparty_domain?: string | null
          counterparty_ticker?: string | null
          created_at?: string
          detail?: string
          doc?: string
          filed?: string
          form?: string
          id?: string
          is_current?: boolean
          link_type?: string | null
          product?: string | null
          quote?: string
          regions?: string[]
          relation?: string
          risk?: string | null
          share_pct?: number | null
          single_source?: boolean
          ticker?: string
        }
        Relationships: []
      }
      supply_signals: {
        Row: {
          accn: string | null
          amount_usd: number | null
          counterparty: string | null
          country: string | null
          created_at: string
          detail: string | null
          doc: string | null
          filed: string | null
          form: string | null
          id: string
          impact: string
          kind: string
          pct: number | null
          period: string | null
          quote: string
          source_kind: string
          speaker: string | null
          ticker: string
          title: string
          url: string | null
        }
        Insert: {
          accn?: string | null
          amount_usd?: number | null
          counterparty?: string | null
          country?: string | null
          created_at?: string
          detail?: string | null
          doc?: string | null
          filed?: string | null
          form?: string | null
          id?: string
          impact?: string
          kind: string
          pct?: number | null
          period?: string | null
          quote: string
          source_kind: string
          speaker?: string | null
          ticker: string
          title: string
          url?: string | null
        }
        Update: {
          accn?: string | null
          amount_usd?: number | null
          counterparty?: string | null
          country?: string | null
          created_at?: string
          detail?: string | null
          doc?: string | null
          filed?: string | null
          form?: string | null
          id?: string
          impact?: string
          kind?: string
          pct?: number | null
          period?: string | null
          quote?: string
          source_kind?: string
          speaker?: string | null
          ticker?: string
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      theses: {
        Row: {
          catalysts: string[]
          conviction: number
          created_at: string
          entry_price: number | null
          horizon: string | null
          id: string
          is_public: boolean
          risks: string[]
          stance: string
          status: string
          summary: string
          target_price: number | null
          ticker: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          catalysts?: string[]
          conviction?: number
          created_at?: string
          entry_price?: number | null
          horizon?: string | null
          id?: string
          is_public?: boolean
          risks?: string[]
          stance?: string
          status?: string
          summary?: string
          target_price?: number | null
          ticker: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          catalysts?: string[]
          conviction?: number
          created_at?: string
          entry_price?: number | null
          horizon?: string | null
          id?: string
          is_public?: boolean
          risks?: string[]
          stance?: string
          status?: string
          summary?: string
          target_price?: number | null
          ticker?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      thesis_updates: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          thesis_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          kind?: string
          thesis_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          thesis_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thesis_updates_thesis_id_fkey"
            columns: ["thesis_id"]
            isOneToOne: false
            referencedRelation: "theses"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist: {
        Row: {
          created_at: string
          id: string
          note: string | null
          ticker: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          ticker: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ir_coverage: {
        Args: never
        Returns: {
          bytes: number
          docs: number
          first_filed: string
          last_filed: string
          read: number
          readable: number
          ticker: string
          vision_read: number
          waiting: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
