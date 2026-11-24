-- Copy-on-write history freezes the rows that change while a snapshot is paged into R2.
CREATE TABLE snapshot_runs(id TEXT PRIMARY KEY,phase TEXT NOT NULL DEFAULT 'queued',created_at TEXT NOT NULL,
  started_ms INTEGER,bookmark TEXT,table_no INTEGER NOT NULL DEFAULT 0,cursor INTEGER NOT NULL DEFAULT 0,part INTEGER NOT NULL DEFAULT 0,
  object_cursor TEXT,finished_at TEXT);
CREATE UNIQUE INDEX single_snapshot ON snapshot_runs((1)) WHERE phase IN ('starting','rows','objects','publishing');
CREATE TABLE snapshot_original(source TEXT NOT NULL,seq INTEGER NOT NULL,original TEXT, PRIMARY KEY(source,seq));
CREATE TABLE snapshot_parts(run_id TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(run_id,key));
CREATE TRIGGER snapshot_users_insert AFTER INSERT ON users
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'users',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='users' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_users_update AFTER UPDATE ON users
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'users',OLD.rowid,json_object('id',OLD.id,'role',OLD.role,'disabled_at',OLD.disabled_at,'created_at',OLD.created_at) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='users' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_users_delete AFTER DELETE ON users
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'users',OLD.rowid,json_object('id',OLD.id,'role',OLD.role,'disabled_at',OLD.disabled_at,'created_at',OLD.created_at) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='users' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_user_emails_insert AFTER INSERT ON user_emails
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'user_emails',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='user_emails' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_user_emails_update AFTER UPDATE ON user_emails
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'user_emails',OLD.rowid,json_object('email',OLD.email,'user_id',OLD.user_id) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='user_emails' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_user_emails_delete AFTER DELETE ON user_emails
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'user_emails',OLD.rowid,json_object('email',OLD.email,'user_id',OLD.user_id) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='user_emails' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_domains_insert AFTER INSERT ON domains
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'domains',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='domains' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_domains_update AFTER UPDATE ON domains
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'domains',OLD.rowid,json_object('id',OLD.id,'name',OLD.name,'created_by',OLD.created_by) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='domains' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_domains_delete AFTER DELETE ON domains
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'domains',OLD.rowid,json_object('id',OLD.id,'name',OLD.name,'created_by',OLD.created_by) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='domains' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_domain_admins_insert AFTER INSERT ON domain_admins
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'domain_admins',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='domain_admins' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_domain_admins_update AFTER UPDATE ON domain_admins
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'domain_admins',OLD.rowid,json_object('domain_id',OLD.domain_id,'user_id',OLD.user_id) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='domain_admins' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_domain_admins_delete AFTER DELETE ON domain_admins
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'domain_admins',OLD.rowid,json_object('domain_id',OLD.domain_id,'user_id',OLD.user_id) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='domain_admins' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_mailboxes_insert AFTER INSERT ON mailboxes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'mailboxes',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='mailboxes' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_mailboxes_update AFTER UPDATE ON mailboxes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'mailboxes',OLD.rowid,json_object('id',OLD.id,'domain_id',OLD.domain_id,'address',OLD.address,'display_name',OLD.display_name,'created_by',OLD.created_by) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='mailboxes' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_mailboxes_delete AFTER DELETE ON mailboxes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'mailboxes',OLD.rowid,json_object('id',OLD.id,'domain_id',OLD.domain_id,'address',OLD.address,'display_name',OLD.display_name,'created_by',OLD.created_by) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='mailboxes' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_mailbox_members_insert AFTER INSERT ON mailbox_members
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'mailbox_members',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='mailbox_members' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_mailbox_members_update AFTER UPDATE ON mailbox_members
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'mailbox_members',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'user_id',OLD.user_id,'role',OLD.role) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='mailbox_members' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_mailbox_members_delete AFTER DELETE ON mailbox_members
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'mailbox_members',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'user_id',OLD.user_id,'role',OLD.role) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='mailbox_members' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_addresses_insert AFTER INSERT ON addresses
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'addresses',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='addresses' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_addresses_update AFTER UPDATE ON addresses
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'addresses',OLD.rowid,json_object('canonical',OLD.canonical,'address',OLD.address,'mailbox_id',OLD.mailbox_id,'kind',OLD.kind) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='addresses' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_addresses_delete AFTER DELETE ON addresses
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'addresses',OLD.rowid,json_object('canonical',OLD.canonical,'address',OLD.address,'mailbox_id',OLD.mailbox_id,'kind',OLD.kind) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='addresses' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_messages_insert AFTER INSERT ON messages
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'messages',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='messages' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_messages_update AFTER UPDATE ON messages
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'messages',OLD.rowid,json_object('rowid',OLD.rowid,'id',OLD.id,'mailbox_id',OLD.mailbox_id,'content_hash',OLD.content_hash,'wire_id',OLD.wire_id,'synthetic',OLD.synthetic,'sender',OLD.sender,'subject',OLD.subject,'snippet',OLD.snippet,'body_key',OLD.body_key,'received_at',OLD.received_at,'attachment_count',OLD.attachment_count,'folder',OLD.folder,'is_read',OLD.is_read,'starred',OLD.starred) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='messages' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_messages_delete AFTER DELETE ON messages
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'messages',OLD.rowid,json_object('rowid',OLD.rowid,'id',OLD.id,'mailbox_id',OLD.mailbox_id,'content_hash',OLD.content_hash,'wire_id',OLD.wire_id,'synthetic',OLD.synthetic,'sender',OLD.sender,'subject',OLD.subject,'snippet',OLD.snippet,'body_key',OLD.body_key,'received_at',OLD.received_at,'attachment_count',OLD.attachment_count,'folder',OLD.folder,'is_read',OLD.is_read,'starred',OLD.starred) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='messages' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_deliveries_insert AFTER INSERT ON deliveries
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'deliveries',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='deliveries' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_deliveries_update AFTER UPDATE ON deliveries
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'deliveries',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'raw_key',OLD.raw_key,'envelope_from',OLD.envelope_from,'envelope_to',OLD.envelope_to,'matched_address',OLD.matched_address,'kind',OLD.kind,'plus_tag',OLD.plus_tag,'received_at',OLD.received_at,'auth',OLD.auth) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='deliveries' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_deliveries_delete AFTER DELETE ON deliveries
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'deliveries',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'raw_key',OLD.raw_key,'envelope_from',OLD.envelope_from,'envelope_to',OLD.envelope_to,'matched_address',OLD.matched_address,'kind',OLD.kind,'plus_tag',OLD.plus_tag,'received_at',OLD.received_at,'auth',OLD.auth) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='deliveries' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_ingest_failures_insert AFTER INSERT ON ingest_failures
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'ingest_failures',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='ingest_failures' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_ingest_failures_update AFTER UPDATE ON ingest_failures
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'ingest_failures',OLD.rowid,json_object('raw_key',OLD.raw_key,'attempts',OLD.attempts,'last_at',OLD.last_at) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='ingest_failures' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_ingest_failures_delete AFTER DELETE ON ingest_failures
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'ingest_failures',OLD.rowid,json_object('raw_key',OLD.raw_key,'attempts',OLD.attempts,'last_at',OLD.last_at) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='ingest_failures' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_reconciliation_insert AFTER INSERT ON reconciliation
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'reconciliation',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='reconciliation' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_reconciliation_update AFTER UPDATE ON reconciliation
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'reconciliation',OLD.rowid,json_object('id',OLD.id,'cursor',OLD.cursor) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='reconciliation' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_reconciliation_delete AFTER DELETE ON reconciliation
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'reconciliation',OLD.rowid,json_object('id',OLD.id,'cursor',OLD.cursor) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='reconciliation' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_provider_probes_insert AFTER INSERT ON provider_probes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'provider_probes',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='provider_probes' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_provider_probes_update AFTER UPDATE ON provider_probes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'provider_probes',OLD.rowid,json_object('run_id',OLD.run_id,'provider',OLD.provider,'path',OLD.path,'started_by',OLD.started_by,'submission_id',OLD.submission_id,'state',OLD.state,'provider_id',OLD.provider_id,'supplied_wire_id',OLD.supplied_wire_id) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='provider_probes' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_provider_probes_delete AFTER DELETE ON provider_probes
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'provider_probes',OLD.rowid,json_object('run_id',OLD.run_id,'provider',OLD.provider,'path',OLD.path,'started_by',OLD.started_by,'submission_id',OLD.submission_id,'state',OLD.state,'provider_id',OLD.provider_id,'supplied_wire_id',OLD.supplied_wire_id) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='provider_probes' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_message_labels_insert AFTER INSERT ON message_labels
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'message_labels',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='message_labels' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_message_labels_update AFTER UPDATE ON message_labels
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'message_labels',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'label',OLD.label) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='message_labels' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_message_labels_delete AFTER DELETE ON message_labels
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'message_labels',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'label',OLD.label) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='message_labels' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_message_metadata_insert AFTER INSERT ON message_metadata
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'message_metadata',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='message_metadata' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_message_metadata_update AFTER UPDATE ON message_metadata
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'message_metadata',OLD.rowid,json_object('message_id',OLD.message_id,'raw_bytes',OLD.raw_bytes,'recipients',OLD.recipients,'cc',OLD.cc) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='message_metadata' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_message_metadata_delete AFTER DELETE ON message_metadata
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'message_metadata',OLD.rowid,json_object('message_id',OLD.message_id,'raw_bytes',OLD.raw_bytes,'recipients',OLD.recipients,'cc',OLD.cc) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='message_metadata' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_thread_members_insert AFTER INSERT ON thread_members
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'thread_members',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='thread_members' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_thread_members_update AFTER UPDATE ON thread_members
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'thread_members',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'thread_id',OLD.thread_id,'sender_key',OLD.sender_key,'subject_key',OLD.subject_key,'automated',OLD.automated) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='thread_members' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_thread_members_delete AFTER DELETE ON thread_members
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'thread_members',OLD.rowid,json_object('mailbox_id',OLD.mailbox_id,'message_id',OLD.message_id,'thread_id',OLD.thread_id,'sender_key',OLD.sender_key,'subject_key',OLD.subject_key,'automated',OLD.automated) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='thread_members' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_drafts_insert AFTER INSERT ON drafts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'drafts',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='drafts' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_drafts_update AFTER UPDATE ON drafts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'drafts',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'content',OLD.content,'revision',OLD.revision,'updated_at',OLD.updated_at,'parent',OLD.parent) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='drafts' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_drafts_delete AFTER DELETE ON drafts
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'drafts',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'content',OLD.content,'revision',OLD.revision,'updated_at',OLD.updated_at,'parent',OLD.parent) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='drafts' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_reply_headers_insert AFTER INSERT ON reply_headers
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'reply_headers',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='reply_headers' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_reply_headers_update AFTER UPDATE ON reply_headers
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'reply_headers',OLD.rowid,json_object('message_id',OLD.message_id,'reply_to',OLD.reply_to,'reference_ids',OLD.reference_ids) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='reply_headers' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_reply_headers_delete AFTER DELETE ON reply_headers
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'reply_headers',OLD.rowid,json_object('message_id',OLD.message_id,'reply_to',OLD.reply_to,'reference_ids',OLD.reference_ids) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='reply_headers' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_outbox_insert AFTER INSERT ON outbox
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'outbox',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='outbox' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_outbox_update AFTER UPDATE ON outbox
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'outbox',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'provider',OLD.provider,'from_addr',OLD.from_addr,'reply_addr',OLD.reply_addr,'letter',OLD.letter,'parent',OLD.parent,'units',OLD.units,'state',OLD.state,'due_ms',OLD.due_ms,'claimed_ms',OLD.claimed_ms,'attempts',OLD.attempts,'reserved_day',OLD.reserved_day,'error_code',OLD.error_code,'provider_id',OLD.provider_id,'created_at',OLD.created_at) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='outbox' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_outbox_delete AFTER DELETE ON outbox
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'outbox',OLD.rowid,json_object('id',OLD.id,'mailbox_id',OLD.mailbox_id,'actor',OLD.actor,'provider',OLD.provider,'from_addr',OLD.from_addr,'reply_addr',OLD.reply_addr,'letter',OLD.letter,'parent',OLD.parent,'units',OLD.units,'state',OLD.state,'due_ms',OLD.due_ms,'claimed_ms',OLD.claimed_ms,'attempts',OLD.attempts,'reserved_day',OLD.reserved_day,'error_code',OLD.error_code,'provider_id',OLD.provider_id,'created_at',OLD.created_at) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='outbox' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_outbox_control_insert AFTER INSERT ON outbox_control
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'outbox_control',NEW.rowid,NULL WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='outbox_control' AND seq=NEW.rowid);
END;
CREATE TRIGGER snapshot_outbox_control_update AFTER UPDATE ON outbox_control
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'outbox_control',OLD.rowid,json_object('id',OLD.id,'paused',OLD.paused) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='outbox_control' AND seq=OLD.rowid);
END;
CREATE TRIGGER snapshot_outbox_control_delete AFTER DELETE ON outbox_control
WHEN EXISTS(SELECT 1 FROM snapshot_runs WHERE phase IN ('starting','rows'))
BEGIN
  INSERT INTO snapshot_original SELECT 'outbox_control',OLD.rowid,json_object('id',OLD.id,'paused',OLD.paused) WHERE NOT EXISTS
    (SELECT 1 FROM snapshot_original WHERE source='outbox_control' AND seq=OLD.rowid);
END;
