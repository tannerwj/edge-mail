-- Signed aliases live with their originating forward. A single redemption can own one queued reply.
CREATE UNIQUE INDEX signed_forward_alias ON outbox(json_extract(letter,'$.replyAlias')) WHERE json_extract(letter,'$.replyAlias') IS NOT NULL;
CREATE UNIQUE INDEX redeem_forward_once ON outbox(json_extract(letter,'$.replyForward')) WHERE json_extract(letter,'$.replyForward') IS NOT NULL;
