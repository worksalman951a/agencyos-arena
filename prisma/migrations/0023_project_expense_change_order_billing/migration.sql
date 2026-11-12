-- Phase 5B-2: source linkage for explicitly billed project expenses and
-- approved change orders. Additive only: all existing invoice lines and source
-- records remain untouched and are interpreted as unbilled until a deliberate
-- billing action creates a source-linked line.
ALTER TABLE "InvoiceItem"
  ADD COLUMN "sourceExpenseId" TEXT,
  ADD COLUMN "sourceChangeOrderId" TEXT;

-- Each source can contribute to at most one invoice line. PostgreSQL permits
-- multiple NULLs, preserving all legacy/manual lines.
CREATE UNIQUE INDEX "InvoiceItem_sourceExpenseId_key"
  ON "InvoiceItem"("sourceExpenseId");
CREATE UNIQUE INDEX "InvoiceItem_sourceChangeOrderId_key"
  ON "InvoiceItem"("sourceChangeOrderId");

-- Restrict source deletion while an invoice line refers to it. The app also
-- blocks edits/deletion of billed sources; source financial history is retained.
ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_sourceExpenseId_fkey"
  FOREIGN KEY ("sourceExpenseId") REFERENCES "ExpenseItem"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_sourceChangeOrderId_fkey"
  FOREIGN KEY ("sourceChangeOrderId") REFERENCES "ChangeOrder"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- A source row is locked by the billing transaction before the invoice line is
-- inserted. This trigger closes the edit/billing race: an edit that waits for
-- that lock sees the committed link and is refused; an edit that wins first is
-- observed by the later billing eligibility checks.
CREATE FUNCTION prevent_billed_source_update() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'ExpenseItem' AND EXISTS (
    SELECT 1 FROM "InvoiceItem" WHERE "sourceExpenseId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'A billed expense is immutable' USING ERRCODE = '23514';
  ELSIF TG_TABLE_NAME = 'ChangeOrder' AND EXISTS (
    SELECT 1 FROM "InvoiceItem" WHERE "sourceChangeOrderId" = OLD.id
  ) THEN
    RAISE EXCEPTION 'A billed change order is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ExpenseItem_billed_source_immutable"
  BEFORE UPDATE ON "ExpenseItem"
  FOR EACH ROW EXECUTE FUNCTION prevent_billed_source_update();
CREATE TRIGGER "ChangeOrder_billed_source_immutable"
  BEFORE UPDATE ON "ChangeOrder"
  FOR EACH ROW EXECUTE FUNCTION prevent_billed_source_update();
