import assert from "node:assert/strict";
export async function claimRace(worker, db, ownerJWT, editorJWT) {
  const { mailbox_id, thread_id } = await db
    .prepare(
      "SELECT t.mailbox_id,t.thread_id FROM thread_members t JOIN mailboxes b ON b.id=t.mailbox_id WHERE b.address='push@example.test' LIMIT 1",
    )
    .first();
  const endpoint = "http://127.0.0.1/api/mailboxes/" + mailbox_id + "/claims/" + thread_id;
  const post = async (jwt, action) =>
    worker.dispatchFetch(endpoint, {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": jwt,
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });
  await db
    .prepare(
      "INSERT INTO mailbox_members(mailbox_id,user_id,role) VALUES(?,'feedback-member','editor')",
    )
    .bind(mailbox_id)
    .run();
  const actors = [ownerJWT, editorJWT],
    results = await Promise.all(actors.map((token) => post(token, "claim")));
  assert.deepEqual(
    results.map((r) => r.status).sort((a, b) => a - b),
    [200, 409],
  );
  const winner = results.findIndex((r) => r.ok);
  assert.equal((await post(actors[1 - winner], "release")).status, 409);
  assert.equal((await post(actors[winner], "release")).status, 200);
  assert.equal((await post(editorJWT, "claim")).status, 200);
  await db
    .prepare("DELETE FROM mailbox_members WHERE mailbox_id=? AND user_id='feedback-member'")
    .bind(mailbox_id)
    .run();
  assert.equal((await post(editorJWT, "claim")).status, 403);
  assert.equal((await post(ownerJWT, "claim")).status, 200);
  assert.equal((await post(ownerJWT, "release")).status, 200);
  console.log(
    "PASS · concurrent editors produce one claimant, only the claimant releases, revoked editor access releases the claim",
  );
}
