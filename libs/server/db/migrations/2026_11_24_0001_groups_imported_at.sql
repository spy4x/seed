-- #230: when a group was made by importing an export file, for the admin panel's "Imported" fact.
-- `NULL` for a group made any other way. Who imported it is `created_by_user_id`: an import
-- creates the group in the importer's name.
ALTER TABLE groups ADD COLUMN imported_at TIMESTAMPTZ;
