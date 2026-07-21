-- 001_initial_schema.sql
-- Hyperfocus Co-Pilot v1 Database Schema
-- Run this in your Supabase SQL editor

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles: one row per user, auto-created on auth sign-up
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  baseline_spoon_budget int DEFAULT 100 CHECK (baseline_spoon_budget >= 0),
  prefers_reduced_motion boolean DEFAULT false,
  prefers_voice boolean DEFAULT false,
  default_focus_duration int DEFAULT 25 CHECK (default_focus_duration > 0)
);

-- Auto-create profile on sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (new.id);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- State sessions: every detected state + intervention + outcome
CREATE TABLE state_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  detected_state text NOT NULL CHECK (detected_state IN ('overwhelmed','frozen','hyperfocus','burnt_out','wobbly','sprint_ready')),
  confidence float NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source text NOT NULL CHECK (source IN ('signal','explicit','predicted')),
  mode text NOT NULL CHECK (mode IN ('freeze_rescue','focus_sprint','soft_recovery')),
  intervention_used text NOT NULL,
  context_snapshot jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  outcome_score int CHECK (outcome_score >= 1 AND outcome_score <= 5),
  outcome_note text,
  would_repeat boolean
);

-- Interventions: catalog of available interventions (seeded, user-extensible in v2)
CREATE TABLE interventions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  mode text NOT NULL CHECK (mode IN ('freeze_rescue','focus_sprint','soft_recovery')),
  label text NOT NULL,
  description text,
  default_prompt text,
  sort_order int DEFAULT 0
);

-- Seed default interventions
INSERT INTO interventions (mode, label, description, default_prompt, sort_order) VALUES
('freeze_rescue', 'micro_step', 'Break task into 2-minute first step', 'Just open the document. That''s it. I''ll wait.', 1),
('freeze_rescue', 'start_for_me', 'Auto-generate the first tiny action', 'I''ve picked your top task and made it tiny. Ready?', 2),
('freeze_rescue', 'sit_with_me', 'Silent co-presence countdown', 'I''m here. We''ll do 2 minutes together. No talking needed.', 3),
('focus_sprint', 'pomodoro_25', '25-minute focused sprint', '25 minutes. One thing. I''ll nudge you at the end.', 1),
('focus_sprint', 'body_double_async', 'Async presence sprint', 'Someone else is sprinting too. You don''t have to chat.', 2),
('soft_recovery', 'ambient_rest', 'Ambient sound + rest messaging', 'Rest is the task right now. Nothing else.', 1),
('soft_recovery', 'gentle_log', 'Log what drained you', 'What drained you? (Optional — just vent if you want.)', 2);

-- Tasks: simple task list (local-first, synced to Supabase)
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  estimated_minutes int CHECK (estimated_minutes > 0),
  priority int DEFAULT 0,
  completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Index for fast memory recall queries
CREATE INDEX idx_state_sessions_user_time ON state_sessions(user_id, started_at DESC);
CREATE INDEX idx_state_sessions_state ON state_sessions(user_id, detected_state, started_at DESC);

-- Row Level Security (RLS) policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can read own state_sessions"
  ON state_sessions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own state_sessions"
  ON state_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own state_sessions"
  ON state_sessions FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can read interventions"
  ON interventions FOR SELECT USING (true);

CREATE POLICY "Users can read own tasks"
  ON tasks FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tasks"
  ON tasks FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks"
  ON tasks FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tasks"
  ON tasks FOR DELETE USING (auth.uid() = user_id);
