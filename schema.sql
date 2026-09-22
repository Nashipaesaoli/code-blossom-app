-- Code Blossom database schema.
-- The server runs this file every time it starts. "IF NOT EXISTS" means it is safe to run again.
-- Timestamps are stored as milliseconds since 1970 (what JavaScript's Date.now() gives you).

-- The languages and tools you are learning
CREATE TABLE IF NOT EXISTS languages (
  id     text PRIMARY KEY,
  name   text    NOT NULL,
  goal   text    NOT NULL DEFAULT '',
  stage  integer NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 4),
  added  bigint  NOT NULL
);

-- Your journal docs
CREATE TABLE IF NOT EXISTS docs (
  id       text PRIMARY KEY,
  title    text    NOT NULL DEFAULT '',
  kind     text    NOT NULL DEFAULT 'notes' CHECK (kind IN ('learning', 'app', 'notes')),
  lang     text    NOT NULL DEFAULT '',
  tags     jsonb   NOT NULL DEFAULT '[]'::jsonb,
  body     text    NOT NULL DEFAULT '',
  created  bigint  NOT NULL,
  updated  bigint  NOT NULL
);

-- Your saved code snippets
CREATE TABLE IF NOT EXISTS snippets (
  id       text PRIMARY KEY,
  title    text    NOT NULL DEFAULT 'Untitled snippet',
  lang     text    NOT NULL DEFAULT '',
  code     text    NOT NULL,
  note     text    NOT NULL DEFAULT '',
  created  bigint  NOT NULL,
  updated  bigint  NOT NULL
);

-- Your saved links
CREATE TABLE IF NOT EXISTS links (
  id       text PRIMARY KEY,
  url      text    NOT NULL,
  title    text    NOT NULL DEFAULT '',
  topic    text    NOT NULL DEFAULT '',
  note     text    NOT NULL DEFAULT '',
  created  bigint  NOT NULL,
  updated  bigint  NOT NULL
);

-- Which steps of the roadmap you have ticked off
CREATE TABLE IF NOT EXISTS steps (
  id    text PRIMARY KEY,
  done  boolean NOT NULL DEFAULT false
);

-- The days you checked in, for your streak. Stored as text like '2026-09-21'.
CREATE TABLE IF NOT EXISTS days (
  day text PRIMARY KEY CHECK (day ~ '^\d{4}-\d{2}-\d{2}$')
);

-- Small settings, like light or dark mode
CREATE TABLE IF NOT EXISTS settings (
  key    text PRIMARY KEY,
  value  text NOT NULL
);
