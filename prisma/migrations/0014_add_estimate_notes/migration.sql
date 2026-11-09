-- Migration 0014: Add Estimate.notes
-- Phase 4: Finance — estimates carry free-form terms/notes in the API, Zod
-- schema and UI, but the column was never created, so creating or updating an
-- estimate failed with a Prisma validation error (500).
--
-- Incremental only: preserves all existing data.

-- ============================================
-- AlterTable: Estimate — add notes
-- ============================================

ALTER TABLE "Estimate" ADD COLUMN "notes" TEXT;
