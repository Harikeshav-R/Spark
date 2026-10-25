BEGIN;
CREATE TABLE public.lecture_summaries (
  lecture_id UUID PRIMARY KEY REFERENCES public.lecture_sessions(id) ON DELETE CASCADE,
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 100 AND 3000),
  key_concepts_covered UUID[] NOT NULL DEFAULT '{}',
  timeline_highlights JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(timeline_highlights) = 'array'),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.lecture_summaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lecture_summaries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.lecture_summaries TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
