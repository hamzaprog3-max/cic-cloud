-- CIC Cloud D1 Database Schema (SQLite)

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_categories (
  id TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  department_id TEXT,
  academic_year TEXT,
  display_order INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  description_ar TEXT DEFAULT '',
  color TEXT NOT NULL DEFAULT '210 70% 50%',
  department_id TEXT,
  academic_year TEXT NOT NULL DEFAULT '1',
  semester TEXT NOT NULL DEFAULT '1',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_courses_dept_year_sem ON courses(department_id, academic_year, semester);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'lecture',
  course_id TEXT NOT NULL,
  category_id TEXT,
  pdf_url TEXT,
  pdf_display_name TEXT,
  external_link TEXT,
  submission_link TEXT,
  deadline TEXT,
  is_assignment INTEGER NOT NULL DEFAULT 0,
  is_list INTEGER NOT NULL DEFAULT 0,
  list_content TEXT,
  is_reference INTEGER NOT NULL DEFAULT 0,
  section_number TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER,
  video_url TEXT,
  deleted_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_materials_course ON materials(course_id, deleted_at, archived);
CREATE INDEX IF NOT EXISTS idx_materials_created ON materials(created_at DESC);

CREATE TABLE IF NOT EXISTS important_links (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_ar TEXT,
  url TEXT NOT NULL,
  is_persistent INTEGER NOT NULL DEFAULT 0,
  department_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  link TEXT,
  target_year TEXT,
  target_dept TEXT,
  color TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_audience TEXT NOT NULL DEFAULT 'all',
  target_year TEXT,
  link TEXT,
  sent_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id TEXT PRIMARY KEY,
  title_template TEXT NOT NULL,
  message_template TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'المالك',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moderators (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]',
  department_id TEXT,
  academic_year TEXT NOT NULL DEFAULT '1',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moderator_course_access (
  id TEXT PRIMARY KEY,
  moderator_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shared_department_courses (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  target_department_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT,
  admin_name TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT DEFAULT '',
  action_type TEXT DEFAULT 'other',
  related_material_id TEXT,
  material_snapshot TEXT,
  admin_year TEXT DEFAULT '1',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- ============ MOODLE 24/7 AUTO-SYNC TABLES ============
CREATE TABLE IF NOT EXISTS moodle_sync_config (
  id TEXT PRIMARY KEY,
  moodle_base_url TEXT NOT NULL DEFAULT 'https://learn3.sha.edu.eg',
  session_cookie TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  notify_students INTEGER NOT NULL DEFAULT 1,
  session_status TEXT NOT NULL DEFAULT 'unconfigured',
  last_check_at TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  last_summary TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moodle_sync_courses (
  id TEXT PRIMARY KEY,
  moodle_course_id TEXT NOT NULL UNIQUE,
  moodle_course_name TEXT NOT NULL,
  cic_course_id TEXT NOT NULL,
  cic_course_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moodle_sync_items (
  id TEXT PRIMARY KEY,
  moodle_course_id TEXT NOT NULL,
  moodle_key TEXT NOT NULL,
  moodle_cmid TEXT NOT NULL,
  moodle_type TEXT NOT NULL,
  moodle_title TEXT NOT NULL,
  source_url TEXT,
  material_id TEXT,
  status TEXT NOT NULL DEFAULT 'synced',
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(moodle_course_id, moodle_key)
);

CREATE INDEX IF NOT EXISTS idx_moodle_sync_items_course ON moodle_sync_items(moodle_course_id, moodle_key);

CREATE TABLE IF NOT EXISTS moodle_sync_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL DEFAULT 'cron',
  status TEXT NOT NULL,
  courses_checked INTEGER NOT NULL DEFAULT 0,
  items_added INTEGER NOT NULL DEFAULT 0,
  items_skipped INTEGER NOT NULL DEFAULT 0,
  errors TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moodle_sync_runs_started ON moodle_sync_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS material_fingerprints (
  material_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  r2_key TEXT,
  byte_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  kind TEXT NOT NULL DEFAULT 'binary',
  tokens_json TEXT NOT NULL DEFAULT '[]',
  stream_hashes_json TEXT NOT NULL DEFAULT '[]',
  sample_text TEXT,
  computed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_material_fp_course ON material_fingerprints(course_id);
CREATE INDEX IF NOT EXISTS idx_material_fp_sha256 ON material_fingerprints(sha256);
