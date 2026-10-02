-- "Not a fit": the person's verdict that a role should never have reached them, with why.
-- Different from Skip, which can mean passing on a good fit. The reason is what the weekly
-- review reads to say what the scorer keeps letting through.
--
-- A column, not a status: the role is Skip like any other pass, so every existing view, count
-- and filter keeps working. Null means not marked.
--
-- Additive only: one nullable column. v_pipeline selects j.*, so it carries the column.
ALTER TABLE jobs ADD COLUMN not_fit_reason TEXT;
