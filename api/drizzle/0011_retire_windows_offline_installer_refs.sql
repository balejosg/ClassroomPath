-- Apply only after the deployment drain gate confirms that no running
-- ClassroomPath instance can read or write legacy Windows installer refs.
-- OpenPath owns the canonical download-ref lifecycle after this migration.
-- The standard ClassroomPath migration runner deliberately defers this file;
-- apply it only with the explicit legacy-retirement confirmation.
DROP TABLE IF EXISTS "cp_windows_offline_download_refs";
