import { cf } from "./cloud-cli.mjs";
export const providerSecrets = [
  "ACCOUNT_ANALYTICS_TOKEN",
  "SUPPRESSION_API_TOKEN",
  "ROUTING_ADDRESS_TOKEN",
];
export function providerBindings(existing, supplied) {
  const names = providerSecrets.filter(
    (name) => supplied[name] || existing.some((b) => b.name === name && b.type === "secret_text"),
  );
  return { EDGE_PROVIDER_BINDINGS: names.join(",") };
}
export function uploadRelease(args, env, inputs) {
  const secrets = Object.fromEntries(
    Object.entries(inputs).filter(([, value]) => typeof value === "string" && value.length),
  );
  if (!Object.keys(secrets).length) return cf(args, { env, stdio: "inherit" });
  // The provider accepts the secret envelope on stdin. Capture process errors without echoing it.
  return cf([...args, "--secrets-file", "/dev/stdin"], {
    env,
    input: JSON.stringify(secrets),
    stdio: ["pipe", "inherit", "inherit"],
  });
}
