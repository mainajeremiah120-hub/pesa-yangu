-- Migration 008: Ticket conversation threading and satisfaction ratings
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS satisfaction_rating INT
    CHECK (satisfaction_rating BETWEEN 1 AND 5);

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id   UUID        NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  sender_role TEXT        NOT NULL DEFAULT 'user'
              CHECK (sender_role IN ('user','admin')),
  message     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_sender ON ticket_messages(sender_id);
