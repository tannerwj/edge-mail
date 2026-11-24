import { unstable_readConfig } from "wrangler";
const config = unstable_readConfig({ config: "wrangler.jsonc" });
if (
  process.env.DEV_IDENTITY ||
  config.vars?.DEV_IDENTITY ||
  config.define?.LOCAL_IDENTITY_ENABLED !== "false"
)
  throw new Error("Remove local identity configuration before deploying");
