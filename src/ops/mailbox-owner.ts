export const owning = `SELECT b.id FROM mailboxes b JOIN users u ON u.id=? AND u.disabled_at IS NULL WHERE b.id=? AND NOT EXISTS(SELECT 1 FROM person_boxes e WHERE e.box=b.id)
 AND (u.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM mailbox_members m WHERE m.user_id=u.id AND m.mailbox_id=b.id AND m.role='owner'))`;
