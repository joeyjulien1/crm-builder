-- Uploaded images and data files share the import files table.
--
-- Images are stored base64-encoded in contents (the column is already text,
-- which keeps this a column addition rather than a new table, a new policy
-- and new grants — the existing tenant_isolation policy covers the new
-- columns unchanged). Data uploads stay raw text so the import reader that
-- parses contents as CSV keeps working byte-for-byte.
--
-- record_id links an attachment to a record later; uploads start unlinked.

alter table files
  add column mime_type text not null default 'text/csv',
  add column byte_size integer not null default 0,
  add column kind text not null default 'import',
  add column record_id uuid references records(id) on delete cascade;

create index files_tenant_record_idx on files (tenant_id, record_id);
