CREATE TABLE thread_members (
  mailbox_id TEXT NOT NULL, message_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  sender_key TEXT NOT NULL, subject_key TEXT NOT NULL, automated INTEGER NOT NULL,
  PRIMARY KEY(mailbox_id,message_id),
  FOREIGN KEY(mailbox_id,message_id) REFERENCES messages(mailbox_id,id),
  FOREIGN KEY(mailbox_id,thread_id) REFERENCES messages(mailbox_id,id)
);
CREATE INDEX conversation_messages ON thread_members(mailbox_id,thread_id,sender_key);
CREATE INDEX conversation_subject ON thread_members(mailbox_id,subject_key,sender_key);
CREATE INDEX conversation_wire ON messages(mailbox_id,wire_id);
