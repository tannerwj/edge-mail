CREATE INDEX outbox_provider_id ON outbox(provider,provider_id,from_addr);

-- Recover the verified builder mapping for historical Cloudflare sends. Leave capture IDs unknown.
UPDATE messages SET wire_id=o.provider_id,synthetic=0
FROM outbox o WHERE o.mailbox_id=messages.mailbox_id AND o.id=messages.id
  AND o.provider='cloudflare' AND o.state='sent' AND messages.wire_id='' AND messages.synthetic=1
  AND o.provider_id GLOB '<*?@?*>' AND length(o.provider_id) BETWEEN 5 AND 997
  AND substr(o.provider_id,2,length(o.provider_id)-2) NOT GLOB '*[<>]*'
  AND o.provider_id NOT GLOB '*[^!-~]*';
