-- SCR #68 / P3-B-04: Add explicit simulation provenance to transcript_chunks
ALTER TABLE public.transcript_chunks ADD COLUMN is_simulated boolean;
