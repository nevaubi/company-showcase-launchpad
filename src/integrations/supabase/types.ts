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
      alert_state: {
        Row: {
          last_seen: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen?: string
          updated_at?: string
          user_id?: string
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
      analyst_estimates: {
        Row: {
          fetched_at: string
          payload: Json
          ticker: string
        }
        Insert: {
          fetched_at?: string
          payload: Json
          ticker: string
        }
        Update: {
          fetched_at?: string
          payload?: Json
          ticker?: string
        }
        Relationships: []
      }
      company_visits: {
        Row: {
          last_seen_at: string
          previous_seen_at: string | null
          ticker: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          previous_seen_at?: string | null
          ticker: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          previous_seen_at?: string | null
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          content: Json
          created_at: string
          firm_id: string | null
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
          firm_id?: string | null
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
          firm_id?: string | null
          id?: string
          kind?: string
          ticker?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      earnings_events: {
        Row: {
          accn: string
          filed: string
          source: string
          ticker: string
        }
        Insert: {
          accn: string
          filed: string
          source?: string
          ticker: string
        }
        Update: {
          accn?: string
          filed?: string
          source?: string
          ticker?: string
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
      filing_redlines: {
        Row: {
          created_at: string
          form: string
          from_accn: string
          high: number
          id: string
          medium: number
          payload: Json
          stats: Json
          summary: Json | null
          ticker: string
          to_accn: string
          to_filed: string
          version: number
        }
        Insert: {
          created_at?: string
          form: string
          from_accn: string
          high?: number
          id?: string
          medium?: number
          payload: Json
          stats?: Json
          summary?: Json | null
          ticker: string
          to_accn: string
          to_filed: string
          version: number
        }
        Update: {
          created_at?: string
          form?: string
          from_accn?: string
          high?: number
          id?: string
          medium?: number
          payload?: Json
          stats?: Json
          summary?: Json | null
          ticker?: string
          to_accn?: string
          to_filed?: string
          version?: number
        }
        Relationships: []
      }
      firm_activity: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          firm_id: string
          id: number
          ticker: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          firm_id: string
          id?: never
          ticker?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          firm_id?: string
          id?: never
          ticker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firm_activity_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_coverage: {
        Row: {
          analyst_id: string | null
          created_at: string
          firm_id: string
          note: string | null
          priority: number
          rating: string
          restricted: boolean
          restricted_reason: string | null
          target_price: number | null
          ticker: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          analyst_id?: string | null
          created_at?: string
          firm_id: string
          note?: string | null
          priority?: number
          rating?: string
          restricted?: boolean
          restricted_reason?: string | null
          target_price?: number | null
          ticker: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          analyst_id?: string | null
          created_at?: string
          firm_id?: string
          note?: string | null
          priority?: number
          rating?: string
          restricted?: boolean
          restricted_reason?: string | null
          target_price?: number | null
          ticker?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firm_coverage_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          firm_id: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["firm_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          firm_id: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["firm_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          firm_id?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["firm_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_invites_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_members: {
        Row: {
          display_name: string | null
          email: string | null
          firm_id: string
          joined_at: string
          role: Database["public"]["Enums"]["firm_role"]
          title: string | null
          user_id: string
        }
        Insert: {
          display_name?: string | null
          email?: string | null
          firm_id: string
          joined_at?: string
          role?: Database["public"]["Enums"]["firm_role"]
          title?: string | null
          user_id: string
        }
        Update: {
          display_name?: string | null
          email?: string | null
          firm_id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["firm_role"]
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_members_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_notes: {
        Row: {
          author_id: string
          body: string
          context: Json
          created_at: string
          firm_id: string
          id: string
          pinned: boolean
          ticker: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          context?: Json
          created_at?: string
          firm_id: string
          id?: string
          pinned?: boolean
          ticker?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          context?: Json
          created_at?: string
          firm_id?: string
          id?: string
          pinned?: boolean
          ticker?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_notes_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firms: {
        Row: {
          branding: Json
          created_at: string
          created_by: string
          id: string
          logo_data: string | null
          name: string
          updated_at: string
        }
        Insert: {
          branding?: Json
          created_at?: string
          created_by: string
          id?: string
          logo_data?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          branding?: Json
          created_at?: string
          created_by?: string
          id?: string
          logo_data?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      insider_buys: {
        Row: {
          accn: string
          filed: string
          is_director: boolean
          is_officer: boolean
          owner: string
          plan_10b5: boolean
          role: string | null
          shares: number | null
          source: string
          ticker: string
          trade_date: string | null
          value: number | null
        }
        Insert: {
          accn: string
          filed: string
          is_director?: boolean
          is_officer?: boolean
          owner: string
          plan_10b5?: boolean
          role?: string | null
          shares?: number | null
          source?: string
          ticker: string
          trade_date?: string | null
          value?: number | null
        }
        Update: {
          accn?: string
          filed?: string
          is_director?: boolean
          is_officer?: boolean
          owner?: string
          plan_10b5?: boolean
          role?: string | null
          shares?: number | null
          source?: string
          ticker?: string
          trade_date?: string | null
          value?: number | null
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
          prose_at: string | null
          prose_facts: number | null
          prose_status: string | null
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
          prose_at?: string | null
          prose_facts?: number | null
          prose_status?: string | null
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
          prose_at?: string | null
          prose_facts?: number | null
          prose_status?: string | null
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
      office_files: {
        Row: {
          created_at: string
          id: string
          kind: string
          owner: string
          size_bytes: number
          storage_path: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id: string
          kind: string
          owner: string
          size_bytes?: number
          storage_path?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          owner?: string
          size_bytes?: number
          storage_path?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      options_daily: {
        Row: {
          atm_iv: number | null
          call_oi: number
          call_vol: number
          date: string
          fetched_at: string
          iv30: number | null
          pc_oi: number | null
          pc_vol: number | null
          price: number
          put_oi: number
          put_vol: number
          skew25: number | null
          term: Json
          ticker: string
        }
        Insert: {
          atm_iv?: number | null
          call_oi?: number
          call_vol?: number
          date: string
          fetched_at?: string
          iv30?: number | null
          pc_oi?: number | null
          pc_vol?: number | null
          price: number
          put_oi?: number
          put_vol?: number
          skew25?: number | null
          term?: Json
          ticker: string
        }
        Update: {
          atm_iv?: number | null
          call_oi?: number
          call_vol?: number
          date?: string
          fetched_at?: string
          iv30?: number | null
          pc_oi?: number | null
          pc_vol?: number | null
          price?: number
          put_oi?: number
          put_vol?: number
          skew25?: number | null
          term?: Json
          ticker?: string
        }
        Relationships: []
      }
      paper_bot_equity: {
        Row: {
          bot_id: string
          date: string
          equity: number
          invested: number
          open_positions: number
          realized: number
          spy: number | null
        }
        Insert: {
          bot_id: string
          date: string
          equity: number
          invested?: number
          open_positions?: number
          realized?: number
          spy?: number | null
        }
        Update: {
          bot_id?: string
          date?: string
          equity?: number
          invested?: number
          open_positions?: number
          realized?: number
          spy?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "paper_bot_equity_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "paper_bots"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_bot_positions: {
        Row: {
          atr: number | null
          bot_id: string
          close_requested: boolean
          cost: number
          created_at: string
          entry_date: string | null
          entry_price: number | null
          exit_date: string | null
          exit_price: number | null
          exit_reason: string | null
          horizon: number
          id: string
          name: string | null
          notional: number | null
          pnl: number | null
          ret: number | null
          ret_spy: number | null
          sector: string | null
          shares: number | null
          side: number
          signal_date: string
          signal_price: number | null
          spy_entry: number | null
          status: string
          stop: number | null
          strategy: string
          target: number | null
          ticker: string
          updated_at: string
          variant: string
        }
        Insert: {
          atr?: number | null
          bot_id: string
          close_requested?: boolean
          cost?: number
          created_at?: string
          entry_date?: string | null
          entry_price?: number | null
          exit_date?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          horizon: number
          id?: string
          name?: string | null
          notional?: number | null
          pnl?: number | null
          ret?: number | null
          ret_spy?: number | null
          sector?: string | null
          shares?: number | null
          side: number
          signal_date: string
          signal_price?: number | null
          spy_entry?: number | null
          status?: string
          stop?: number | null
          strategy: string
          target?: number | null
          ticker: string
          updated_at?: string
          variant: string
        }
        Update: {
          atr?: number | null
          bot_id?: string
          close_requested?: boolean
          cost?: number
          created_at?: string
          entry_date?: string | null
          entry_price?: number | null
          exit_date?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          horizon?: number
          id?: string
          name?: string | null
          notional?: number | null
          pnl?: number | null
          ret?: number | null
          ret_spy?: number | null
          sector?: string | null
          shares?: number | null
          side?: number
          signal_date?: string
          signal_price?: number | null
          spy_entry?: number | null
          status?: string
          stop?: number | null
          strategy?: string
          target?: number | null
          ticker?: string
          updated_at?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_bot_positions_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "paper_bots"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_bots: {
        Row: {
          capital: number
          created_at: string
          description: string | null
          id: string
          last_as_of: string | null
          last_error: string | null
          last_run_at: string | null
          name: string
          rules: Json
          slug: string | null
          started_on: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          capital?: number
          created_at?: string
          description?: string | null
          id?: string
          last_as_of?: string | null
          last_error?: string | null
          last_run_at?: string | null
          name: string
          rules?: Json
          slug?: string | null
          started_on?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          capital?: number
          created_at?: string
          description?: string | null
          id?: string
          last_as_of?: string | null
          last_error?: string | null
          last_run_at?: string | null
          name?: string
          rules?: Json
          slug?: string | null
          started_on?: string
          status?: string
          updated_at?: string
          user_id?: string | null
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
      partner_mirror: {
        Row: {
          bytes: number | null
          error: string | null
          kind: string
          mirrored_at: string
          path: string
          sha256: string | null
          status: string
          ticker: string
        }
        Insert: {
          bytes?: number | null
          error?: string | null
          kind: string
          mirrored_at?: string
          path: string
          sha256?: string | null
          status?: string
          ticker: string
        }
        Update: {
          bytes?: number | null
          error?: string | null
          kind?: string
          mirrored_at?: string
          path?: string
          sha256?: string | null
          status?: string
          ticker?: string
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
      report_runs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          kind: string
          ms: number | null
          report_id: string | null
          scope: string
          source: string
          status: string
          ticker: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          ms?: number | null
          report_id?: string | null
          scope: string
          source?: string
          status?: string
          ticker: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          ms?: number | null
          report_id?: string | null
          scope?: string
          source?: string
          status?: string
          ticker?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_runs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          created_at: string
          created_by: string
          firm_id: string | null
          id: string
          kind: string
          name: string
          options: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          firm_id?: string | null
          id?: string
          kind: string
          name: string
          options?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          firm_id?: string | null
          id?: string
          kind?: string
          name?: string
          options?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_templates_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          content: Json | null
          created_at: string
          data_version: string
          error: string | null
          firm_id: string | null
          id: string
          kind: string
          options: Json
          requested_by: string | null
          scope: string
          started_at: string | null
          status: string
          ticker: string
          title: string | null
          updated_at: string
          user_id: string | null
          variant: string
        }
        Insert: {
          content?: Json | null
          created_at?: string
          data_version?: string
          error?: string | null
          firm_id?: string | null
          id?: string
          kind: string
          options?: Json
          requested_by?: string | null
          scope: string
          started_at?: string | null
          status?: string
          ticker: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
          variant?: string
        }
        Update: {
          content?: Json | null
          created_at?: string
          data_version?: string
          error?: string | null
          firm_id?: string | null
          id?: string
          kind?: string
          options?: Json
          requested_by?: string | null
          scope?: string
          started_at?: string | null
          status?: string
          ticker?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
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
      setup_cycles: {
        Row: {
          as_of: string
          cursor: number
          detail: Json
          finished_at: string | null
          lease_until: string | null
          phase: string
          started_at: string
          updated_at: string
        }
        Insert: {
          as_of: string
          cursor?: number
          detail?: Json
          finished_at?: string | null
          lease_until?: string | null
          phase?: string
          started_at?: string
          updated_at?: string
        }
        Update: {
          as_of?: string
          cursor?: number
          detail?: Json
          finished_at?: string | null
          lease_until?: string | null
          phase?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      setup_results: {
        Row: {
          as_of: string
          generated_at: string
          payload: Json
        }
        Insert: {
          as_of: string
          generated_at?: string
          payload: Json
        }
        Update: {
          as_of?: string
          generated_at?: string
          payload?: Json
        }
        Relationships: []
      }
      setup_samples: {
        Row: {
          d: string
          ex: number
          gross: number
          net: number
          ticker: string
          variant: string
        }
        Insert: {
          d: string
          ex: number
          gross: number
          net: number
          ticker: string
          variant: string
        }
        Update: {
          d?: string
          ex?: number
          gross?: number
          net?: number
          ticker?: string
          variant?: string
        }
        Relationships: []
      }
      setup_scan: {
        Row: {
          bars: number | null
          claimed_at: string | null
          error: string | null
          samples: number | null
          scanned_for: string | null
          sector: string | null
          ticker: string
          updated_at: string
        }
        Insert: {
          bars?: number | null
          claimed_at?: string | null
          error?: string | null
          samples?: number | null
          scanned_for?: string | null
          sector?: string | null
          ticker: string
          updated_at?: string
        }
        Update: {
          bars?: number | null
          claimed_at?: string | null
          error?: string | null
          samples?: number | null
          scanned_for?: string | null
          sector?: string | null
          ticker?: string
          updated_at?: string
        }
        Relationships: []
      }
      setup_series: {
        Row: {
          above200: boolean | null
          c: number[]
          dv20: number | null
          end_date: string
          near_high: boolean | null
          o: number[]
          r21: number | null
          r5: number | null
          sector: string | null
          short5: number | null
          start_date: string
          ticker: string
          updated_at: string
          vol60: number | null
        }
        Insert: {
          above200?: boolean | null
          c: number[]
          dv20?: number | null
          end_date: string
          near_high?: boolean | null
          o: number[]
          r21?: number | null
          r5?: number | null
          sector?: string | null
          short5?: number | null
          start_date: string
          ticker: string
          updated_at?: string
          vol60?: number | null
        }
        Update: {
          above200?: boolean | null
          c?: number[]
          dv20?: number | null
          end_date?: string
          near_high?: boolean | null
          o?: number[]
          r21?: number | null
          r5?: number | null
          sector?: string | null
          short5?: number | null
          start_date?: string
          ticker?: string
          updated_at?: string
          vol60?: number | null
        }
        Relationships: []
      }
      setup_signals: {
        Row: {
          atr: number | null
          context: Json
          cost: number | null
          detail: string | null
          dv20: number | null
          fired_at: string
          first_seen: string
          horizon: number
          last_seen: string
          name: string | null
          outcome_at: string | null
          outcome_ex: number | null
          outcome_net: number | null
          price: number | null
          sector: string | null
          side: number
          spark: number[] | null
          strategy: string
          strength: number | null
          ticker: string
          variant: string
        }
        Insert: {
          atr?: number | null
          context?: Json
          cost?: number | null
          detail?: string | null
          dv20?: number | null
          fired_at: string
          first_seen: string
          horizon: number
          last_seen: string
          name?: string | null
          outcome_at?: string | null
          outcome_ex?: number | null
          outcome_net?: number | null
          price?: number | null
          sector?: string | null
          side: number
          spark?: number[] | null
          strategy: string
          strength?: number | null
          ticker: string
          variant: string
        }
        Update: {
          atr?: number | null
          context?: Json
          cost?: number | null
          detail?: string | null
          dv20?: number | null
          fired_at?: string
          first_seen?: string
          horizon?: number
          last_seen?: string
          name?: string | null
          outcome_at?: string | null
          outcome_ex?: number | null
          outcome_net?: number | null
          price?: number | null
          sector?: string | null
          side?: number
          spark?: number[] | null
          strategy?: string
          strength?: number | null
          ticker?: string
          variant?: string
        }
        Relationships: []
      }
      setup_variant_stats: {
        Row: {
          as_of: string
          stats: Json
          updated_at: string
          variant: string
        }
        Insert: {
          as_of: string
          stats: Json
          updated_at?: string
          variant: string
        }
        Update: {
          as_of?: string
          stats?: Json
          updated_at?: string
          variant?: string
        }
        Relationships: []
      }
      short_volume: {
        Row: {
          date: string
          exempt_vol: number
          short_vol: number
          symbol: string
          total_vol: number
        }
        Insert: {
          date: string
          exempt_vol?: number
          short_vol: number
          symbol: string
          total_vol: number
        }
        Update: {
          date?: string
          exempt_vol?: number
          short_vol?: number
          symbol?: string
          total_vol?: number
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          current_period_end: string | null
          environment: string
          price_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          environment?: string
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          environment?: string
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string
          updated_at?: string
          user_id?: string
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
          firm_id: string | null
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
          firm_id?: string | null
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
          firm_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "theses_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
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
      usage_counters: {
        Row: {
          kind: string
          period: string
          used: number
          user_id: string
        }
        Insert: {
          kind: string
          period: string
          used?: number
          user_id: string
        }
        Update: {
          kind?: string
          period?: string
          used?: number
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          display_name: string | null
          email: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          display_name?: string | null
          email?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          display_name?: string | null
          email?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
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
      xbrl_concentration: {
        Row: {
          accn: string
          benchmark: string
          benchmark_label: string
          counterparty: string | null
          created_at: string
          element_id: string | null
          filed: string
          form: string
          id: number
          kind: string
          label: string
          member: string
          pct: number
          period_end: string
          period_start: string | null
          ticker: string
        }
        Insert: {
          accn: string
          benchmark: string
          benchmark_label?: string
          counterparty?: string | null
          created_at?: string
          element_id?: string | null
          filed: string
          form: string
          id?: never
          kind: string
          label: string
          member: string
          pct: number
          period_end: string
          period_start?: string | null
          ticker: string
        }
        Update: {
          accn?: string
          benchmark?: string
          benchmark_label?: string
          counterparty?: string | null
          created_at?: string
          element_id?: string | null
          filed?: string
          form?: string
          id?: never
          kind?: string
          label?: string
          member?: string
          pct?: number
          period_end?: string
          period_start?: string | null
          ticker?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_firm_invite: { Args: { _token: string }; Returns: string }
      alt_event_buckets: {
        Args: never
        Returns: {
          bucket: number
          dataset: string
          last_date: string
          n: number
          ticker: string
        }[]
      }
      alt_series_leaders: {
        Args: { _dataset: string; _title: string }
        Returns: {
          base_median: number
          base_n: number
          date: string
          meta: Json
          prior_date: string
          prior_value: number
          source_url: string
          ticker: string
          unit: string
          value: number
        }[]
      }
      alt_source_stats: {
        Args: never
        Returns: {
          dataset: string
          latest: string
          refreshed: string
          rows: number
          tickers: number
        }[]
      }
      consume_usage: { Args: { _kind: string }; Returns: Json }
      create_firm: { Args: { _name: string }; Returns: string }
      decide_waitlist: {
        Args: { _status: string; _user: string }
        Returns: undefined
      }
      effective_tier: { Args: { _user: string }; Returns: string }
      firm_role_rank: {
        Args: { _role: Database["public"]["Enums"]["firm_role"] }
        Returns: number
      }
      get_firm_invite: {
        Args: { _token: string }
        Returns: {
          accepted: boolean
          email: string
          expired: boolean
          firm_name: string
          role: Database["public"]["Enums"]["firm_role"]
        }[]
      }
      has_app_access: { Args: { _user: string }; Returns: boolean }
      has_firm_role: {
        Args: {
          _firm: string
          _min: Database["public"]["Enums"]["firm_role"]
          _user: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
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
      ir_live_progress: { Args: never; Returns: Json }
      is_firm_member: {
        Args: { _firm: string; _user: string }
        Returns: boolean
      }
      my_firm_invites: {
        Args: never
        Returns: {
          expires_at: string
          firm_name: string
          role: Database["public"]["Enums"]["firm_role"]
          token: string
        }[]
      }
      options_board: {
        Args: never
        Returns: {
          atm_iv: number
          call_oi: number
          call_vol: number
          date: string
          iv_below: number
          iv_max: number
          iv_min: number
          iv_n: number
          iv_prev: number
          iv30: number
          pc_oi: number
          pc_vol: number
          price: number
          put_oi: number
          put_vol: number
          skew25: number
          term: Json
          ticker: string
          vol_avg20: number
        }[]
      }
      paper_bot_limit: { Args: { _user: string }; Returns: number }
      plan_limit: { Args: { _kind: string; _tier: string }; Returns: number }
      remove_firm_member: {
        Args: { _firm: string; _user: string }
        Returns: undefined
      }
      request_bot_close: { Args: { _position: string }; Returns: undefined }
      require_feature: { Args: { _feature: string }; Returns: boolean }
      reset_paper_bot: { Args: { _bot: string }; Returns: undefined }
      set_firm_member_role: {
        Args: {
          _firm: string
          _role: Database["public"]["Enums"]["firm_role"]
          _user: string
        }
        Returns: undefined
      }
      setup_advance: {
        Args: { _as_of: string; _from: string; _to: string }
        Returns: boolean
      }
      setup_claim_tickers: {
        Args: { _as_of: string; _n: number }
        Returns: {
          sector: string
          ticker: string
        }[]
      }
      setup_forward_stats: {
        Args: never
        Returns: {
          avg_ex: number
          avg_net: number
          first_seen: string
          hits: number
          n: number
          variant: string
        }[]
      }
      setup_lease: {
        Args: { _as_of: string; _phase: string; _secs: number }
        Returns: boolean
      }
      setup_take: {
        Args: { _as_of: string; _n: number; _phase: string }
        Returns: number
      }
      setup_variant_daily: { Args: { _variant: string }; Returns: Json }
      setup_variant_list: {
        Args: never
        Returns: {
          n: number
          variant: string
        }[]
      }
      tier_has_feature: {
        Args: { _feature: string; _tier: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin"
      firm_role: "owner" | "admin" | "analyst" | "viewer"
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
    Enums: {
      app_role: ["admin"],
      firm_role: ["owner", "admin", "analyst", "viewer"],
    },
  },
} as const
