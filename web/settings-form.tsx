import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { Mark } from "./mail-display";
export type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
};
export function Form({
  title,
  fields,
  submit,
}: {
  title: string;
  fields: Field[];
  submit: (data: Record<string, string>) => Promise<unknown>;
}) {
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const client = useQueryClient();
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values: Record<string, string> = {};
    for (const [name, value] of new FormData(form))
      if (typeof value === "string") values[name] = value;
    setBusy(true);
    setStatus("");
    try {
      await submit(values);
      await client.invalidateQueries();
      form.reset();
      setStatus("Saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)}>
      <h3>{title}</h3>
      {fields.map((f) => (
        <label key={f.key}>
          {f.label}
          {f.options ? (
            <select name={f.key} required>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input name={f.key} required type={f.type || "text"} maxLength={254} />
          )}
        </label>
      ))}
      <button disabled={busy}>{title}</button>
      <output>{status}</output>
    </form>
  );
}
export function Setup() {
  return (
    <div className="standalone">
      <div className="wordmark">
        <Mark /> Edge Mail
      </div>
      <h1>Set up your inbox</h1>
      <p>Enter the setup token for this instance to become its first owner.</p>
      <Form
        title="Create owner"
        fields={[{ key: "token", label: "Setup token", type: "password" }]}
        submit={async (d) => {
          await api("setup", d);
          location.replace("/");
        }}
      />
    </div>
  );
}
