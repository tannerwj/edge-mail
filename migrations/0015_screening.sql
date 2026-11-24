CREATE TABLE mailbox_screening (
 mailbox_id TEXT PRIMARY KEY REFERENCES mailboxes, screen_unknown INTEGER NOT NULL DEFAULT 0,
 quarantine_auth INTEGER NOT NULL DEFAULT 1, learn INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sender_list (
 scope_id TEXT NOT NULL, pattern TEXT NOT NULL COLLATE NOCASE, disposition TEXT NOT NULL CHECK(disposition IN ('allow','block')),
 PRIMARY KEY(scope_id,pattern)
);
CREATE TABLE mail_assessment (
 message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, mailbox_id TEXT NOT NULL REFERENCES mailboxes,
 reason TEXT NOT NULL, held INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX assessment_queue ON mail_assessment(mailbox_id,held,message_id);
CREATE TABLE spam_samples (
 message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, spam INTEGER NOT NULL CHECK(spam IN (0,1)),
 words TEXT NOT NULL CHECK(json_valid(words))
);
-- Derived counts are rebuilt by the insert trigger when restoring samples. The empty token counts documents.
CREATE TABLE spam_counts(token TEXT PRIMARY KEY, spam INTEGER NOT NULL, ham INTEGER NOT NULL);
CREATE TRIGGER sample_add AFTER INSERT ON spam_samples BEGIN
 INSERT INTO spam_counts SELECT value,NEW.spam,1-NEW.spam FROM json_each(json_insert(NEW.words,'$[#]','')) WHERE true
 ON CONFLICT(token) DO UPDATE SET spam=spam+excluded.spam,ham=ham+excluded.ham;
END;
CREATE TRIGGER sample_remove AFTER DELETE ON spam_samples BEGIN
 UPDATE spam_counts SET spam=spam-OLD.spam,ham=ham-(1-OLD.spam) WHERE token IN(SELECT value FROM json_each(json_insert(OLD.words,'$[#]','')));
 DELETE FROM spam_counts WHERE token IN(SELECT value FROM json_each(json_insert(OLD.words,'$[#]',''))) AND spam=0 AND ham=0;
END;
CREATE TRIGGER snapshot_mailbox_screening_insert AFTER INSERT ON mailbox_screening
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'mailbox_screening',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mailbox_screening' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_mailbox_screening_update AFTER UPDATE ON mailbox_screening
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'mailbox_screening',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'screen_unknown',OLD.screen_unknown,'quarantine_auth',OLD.quarantine_auth,'learn',OLD.learn) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mailbox_screening' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_mailbox_screening_delete AFTER DELETE ON mailbox_screening
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'mailbox_screening',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'screen_unknown',OLD.screen_unknown,'quarantine_auth',OLD.quarantine_auth,'learn',OLD.learn) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mailbox_screening' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_sender_list_insert AFTER INSERT ON sender_list
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'sender_list',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='sender_list' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_sender_list_update AFTER UPDATE ON sender_list
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'sender_list',OLD.rowid,json_object('scope_id',OLD.scope_id,'pattern',OLD.pattern,'disposition',OLD.disposition) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='sender_list' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_sender_list_delete AFTER DELETE ON sender_list
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'sender_list',OLD.rowid,json_object('scope_id',OLD.scope_id,'pattern',OLD.pattern,'disposition',OLD.disposition) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='sender_list' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_mail_assessment_insert AFTER INSERT ON mail_assessment
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'mail_assessment',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mail_assessment' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_mail_assessment_update AFTER UPDATE ON mail_assessment
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'mail_assessment',OLD.rowid,json_object('message_id',OLD.message_id,'mailbox_id',OLD.mailbox_id,'reason',OLD.reason,'held',OLD.held) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mail_assessment' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_mail_assessment_delete AFTER DELETE ON mail_assessment
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'mail_assessment',OLD.rowid,json_object('message_id',OLD.message_id,'mailbox_id',OLD.mailbox_id,'reason',OLD.reason,'held',OLD.held) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='mail_assessment' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_spam_samples_insert AFTER INSERT ON spam_samples
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'spam_samples',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='spam_samples' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_spam_samples_update AFTER UPDATE ON spam_samples
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'spam_samples',OLD.rowid,json_object('message_id',OLD.message_id,'spam',OLD.spam,'words',OLD.words) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='spam_samples' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_spam_samples_delete AFTER DELETE ON spam_samples
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'spam_samples',OLD.rowid,json_object('message_id',OLD.message_id,'spam',OLD.spam,'words',OLD.words) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='spam_samples' AND seq=OLD.rowid);
END;
CREATE TABLE vacation_replies(
 id TEXT PRIMARY KEY,mailbox_id TEXT NOT NULL REFERENCES mailboxes,message_id TEXT NOT NULL REFERENCES messages(id),
 rule_id TEXT NOT NULL,revision INTEGER NOT NULL,sender TEXT NOT NULL COLLATE NOCASE,until_ms INTEGER NOT NULL,
 UNIQUE(mailbox_id,message_id),FOREIGN KEY(rule_id,revision) REFERENCES rule_versions
);
CREATE INDEX vacation_sender ON vacation_replies(mailbox_id,sender,until_ms);
CREATE TRIGGER snapshot_vacation_replies_insert AFTER INSERT ON vacation_replies
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'vacation_replies',NEW.rowid,NULL WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='vacation_replies' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_vacation_replies_update AFTER UPDATE ON vacation_replies
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'vacation_replies',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'rule_id',OLD.rule_id,'revision',OLD.revision,'sender',OLD.sender,'until_ms',OLD.until_ms) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='vacation_replies' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_vacation_replies_delete AFTER DELETE ON vacation_replies
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
 INSERT INTO snapshot_original SELECT 'vacation_replies',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'rule_id',OLD.rule_id,'revision',OLD.revision,'sender',OLD.sender,'until_ms',OLD.until_ms) WHERE NOT EXISTS
 (SELECT 1 FROM snapshot_original WHERE source='vacation_replies' AND seq=OLD.rowid);
END;
