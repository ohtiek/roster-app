-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 027 · ON UPDATE CASCADE on every FK referencing staff(id)
--
-- Defensive schema hygiene: staff.id is a UUID surrogate key that should
-- essentially never need to change, but if it ever did (a merge/migration
-- script, a future admin tool), every referencing row should follow rather
-- than the update failing outright or leaving orphaned references.
--
-- None of these FKs were given explicit names when declared inline across
-- migrations 000-018, so this looks them up dynamically via pg_constraint
-- rather than guessing 9 auto-generated names — and picks up any future FK
-- to staff(id) the same way, with no changes needed here.
--
-- Preserves each FK's existing ON DELETE behavior; only adds ON UPDATE
-- CASCADE, which was previously unset (defaulting to NO ACTION).
--
-- Caveat that this migration does NOT and CANNOT fix: roster_history.payload
-- stores staff_id as plain JSON inside a JSONB column, not a real foreign
-- key. Changing a staff.id after that staff member has appeared in a
-- generated roster leaves that roster's stored payload referencing the old,
-- now-nonexistent id — ON UPDATE CASCADE only ever touches real FK columns.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fk RECORD;
  _delete_action TEXT;
BEGIN
  FOR fk IN
    SELECT
      con.conname,
      con.conrelid::regclass::text AS local_table,
      (SELECT attname FROM pg_attribute WHERE attrelid = con.conrelid AND attnum = con.conkey[1]) AS local_col,
      con.confdeltype
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = 'staff'::regclass
      AND array_length(con.conkey, 1) = 1
  LOOP
    _delete_action := CASE fk.confdeltype
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      WHEN 'r' THEN 'RESTRICT'
      ELSE 'NO ACTION'
    END;

    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.local_table, fk.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES staff(id) ON DELETE %s ON UPDATE CASCADE',
      fk.local_table, fk.conname, fk.local_col, _delete_action
    );

    RAISE NOTICE 'staff(id) FK %.% : ON DELETE % ON UPDATE CASCADE', fk.local_table, fk.local_col, _delete_action;
  END LOOP;
END $$;
