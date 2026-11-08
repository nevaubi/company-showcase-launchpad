import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

/** Server-built SEC review and proposed-sale files (pipeline: etl/comment_letters.py, etl/form144.py). */

export interface Form144Notice {
  accession: string;
  filed: string;
  url: string | null;
  person: string | null;
  relationship: string | null;
  shares: number | null;
  value: number | null;
  pct_outstanding: number | null;
  sale_date: string | null;
  brokers?: string[];
  how?: string | null;
  past3m_shares?: number | null;
  past3m_proceeds?: number | null;
  plan: boolean;
  plan_adopted: string[];
  status: "executed" | "open" | "not_reported";
  executed?: {
    shares: number;
    value: number;
    first: string;
    last: string;
    accessions: string[];
    plan_10b5: boolean;
    filled_pct: number | null;
  } | null;
}

interface Window {
  n: number;
  value: number;
  people: number;
  plan_share: number | null;
}

export interface Form144File {
  ticker: string;
  generated: string;
  summary: {
    d30: Window;
    d90: Window;
    d365: Window;
    open: { n: number; value: number; people: string[] };
  };
  notices: Form144Notice[];
}

export interface CommentLetter {
  accession: string;
  form: "UPLOAD" | "CORRESP";
  filed: string;
  kind: "comments" | "review_complete" | "response" | "other";
  url: string;
  n_comments: number | null;
  comments?: { n: number; heading: string | null; text: string }[];
  topics?: string[];
  replies_to?: string | null;
}

export interface ReviewThread {
  key: string;
  subject: string | null;
  form: string | null;
  period: string | null;
  first: string;
  last: string;
  status: "open" | "complete";
  rounds: number;
  n_comments: number;
  topics: string[];
  periodic: boolean;
  letters: CommentLetter[];
}

export interface CommentsFile {
  ticker: string;
  generated: string;
  threads: ReviewThread[];
  topics: Record<string, string>;
  n_threads: number;
}

export const form144Query = (ticker: string) =>
  queryOptions({
    queryKey: ["form144", ticker],
    queryFn: () => partnerFile<Form144File>(`form144/${ticker}.json`),
    staleTime: 15 * 60_000,
    retry: false,
  });

export const commentsQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["sec-comments", ticker],
    queryFn: () => partnerFile<CommentsFile>(`comments/${ticker}.json`),
    staleTime: 60 * 60_000,
    retry: false,
  });

export const NOTICE_STATUS: Record<
  Form144Notice["status"],
  { label: string; tone: "pos" | "warn" | "muted" }
> = {
  executed: { label: "Sold (Form 4)", tone: "muted" },
  open: { label: "Open", tone: "warn" },
  not_reported: { label: "No Form 4 match", tone: "muted" },
};
