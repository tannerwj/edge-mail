export function readPolicy(form: FormData) {
  const raw = form.get("permittedRecipients");
  return {
    mode: form.get("sendPolicy"),
    daily_cap: Number(form.get("dailyCap")) || null,
    recipients: typeof raw === "string" && raw.trim() ? raw.trim().split(/[\s,]+/) : null,
    review_egress: form.has("reviewEgress"),
  };
}
export function PolicyFields() {
  return (
    <details>
      <summary>Optional agent limits</summary>
      <label>
        Send policy
        <select name="sendPolicy" defaultValue="allow">
          <option value="allow">Allow sends</option>
          <option value="hold_all">Approve every send</option>
          <option value="hold_new_recipients">Approve new recipients</option>
          <option value="drafts_only">Save drafts only</option>
        </select>
      </label>
      <label>
        Daily recipient limit
        <input type="number" name="dailyCap" min="1" max="10000" placeholder="Unlimited" />
      </label>
      <label>
        Permitted recipients
        <input name="permittedRecipients" placeholder="Any recipient" maxLength={8000} />
      </label>
      <small>Separate addresses with commas. These limits also apply to child credentials.</small>
      <label>
        <input type="checkbox" name="reviewEgress" />
        Approve new forwarding, auto-reply and webhook destinations
      </label>
    </details>
  );
}
