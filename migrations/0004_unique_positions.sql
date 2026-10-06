-- Positions are unique within a section (items) and across the crate (records), so reordering swaps two rows
-- (plan 1 follow-up). The non-unique index from 0001 is replaced by a unique one of the same name.
DROP INDEX items_section_position;
CREATE UNIQUE INDEX items_section_position ON items (section, position);
CREATE UNIQUE INDEX records_position ON records (position);
