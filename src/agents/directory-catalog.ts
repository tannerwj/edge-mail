import type { Entry } from "./catalog";
const operations: [string, string, string[]][] = [
  ["domain_list", "List receiving domains", []],
  ["user_list", "List instance members and sign-in addresses", []],
  ["settings_get", "Inspect delivery settings and budgets", []],
  ["domain_add", "Add a receiving domain to the directory", ["name"]],
  ["user_add", "Add a member sign-in address", ["email"]],
  ["mailbox_create", "Create a mailbox in a configured domain", ["address", "name"]],
  ["grant_list", "List descendant grants", []],
  ["token_list", "List delegated API token grants", []],
  ["grant_revoke", "Revoke a descendant grant and its children", ["id"]],
  ["token_revoke", "Revoke a delegated token grant and its children", ["id"]],
];
export const directoryCatalog: Entry[] = [
  ...operations.map(([name, description, fields]) => {
    const write = /_(add|create|revoke)$/.test(name);
    return {
      name,
      description,
      fields: [...fields, ...(write ? ["dry_run"] : [])],
      scope: "admin" as const,
      write,
    };
  }),
  {
    name: "egress_destination_add",
    scope: "mail.write",
    description: "Register a forwarding destination for recipient verification",
    fields: ["mailbox", "address", "dry_run"],
    mailbox: true,
    write: true,
  },
  {
    name: "egress_destination_list",
    scope: "mail.read",
    description: "List mailbox forwarding destinations and verification state",
    fields: ["mailbox"],
    mailbox: true,
  },
];
