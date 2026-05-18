-- Correction journal: add ADD_ENTRIES mode (2026-05-18)

-- 1. Add mode column on correction_journals (CORRECTION = existing behavior, ADD_ENTRIES = append new entries to parent journal without replacing existing)
ALTER TABLE correction_journals
  ADD COLUMN IF NOT EXISTS mode VARCHAR(16) NOT NULL DEFAULT 'CORRECTION'
  CHECK (mode IN ('CORRECTION','ADD_ENTRIES'));

-- 2. Relax NOT NULL on original-side and source-entry-id columns: ADD_ENTRIES mode has no original
ALTER TABLE correction_journal_entries ALTER COLUMN source_journal_entry_id DROP NOT NULL;
ALTER TABLE correction_journal_entries ALTER COLUMN original_type           DROP NOT NULL;
ALTER TABLE correction_journal_entries ALTER COLUMN original_amount         DROP NOT NULL;
ALTER TABLE correction_journal_entries ALTER COLUMN original_account_id     DROP NOT NULL;
