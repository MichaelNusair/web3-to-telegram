import axios from "axios";

/* Types */
interface WatchedAsset {
  name: string;
  address: string;
}

/* Env helpers */
const getEnvVar = (name: string): string => {
  const value = process.env[name];
  if (!value)
    throw new Error(`Environment variable ${name} is required but not set`);
  return value;
};

const parseJsonEnv = <T>(name: string): T => {
  const jsonString = getEnvVar(name);
  return JSON.parse(jsonString) as T;
};

/* Config */
const RPC_URL = getEnvVar("RPC_URL");
const DATA_PROVIDER = getEnvVar("DATA_PROVIDER_ADDRESS");
const BOTS = {
  true: {
    token: getEnvVar("ALERT_BOT_TOKEN"),
    chat_id: getEnvVar("ALERT_BOT_CHAT_ID"),
  },
  false: {
    token: getEnvVar("NO_ALERT_BOT_TOKEN"),
    chat_id: getEnvVar("NO_ALERT_BOT_CHAT_ID"),
  },
};
const WATCH_LIST = parseJsonEnv<WatchedAsset[]>("WATCH_LIST");

/* Chain lazy init (ethers v6 is ESM-only) */
let chainInit: Promise<{
  E: typeof import("ethers");
  dp: any;
  ALERT_THRESHOLD: bigint;
}> | null = null;

const ensureChain = () => {
  if (!chainInit) {
    chainInit = (async () => {
      const E = await import("ethers");
      const provider = new E.ethers.JsonRpcProvider(RPC_URL);
      const ABI = [
        "function getATokenTotalSupply(address) view returns (uint256)",
        "function getReserveCaps(address) view returns (uint256 borrowCap, uint256 supplyCap)",
      ];
      const dp = new E.ethers.Contract(DATA_PROVIDER, ABI, provider);
      const ALERT_THRESHOLD = E.ethers.parseUnits(
        getEnvVar("ALERT_THRESHOLD_TOKENS"),
        18
      );
      return { E, dp, ALERT_THRESHOLD };
    })();
  }
  return chainInit;
};

const UNIT = 10n ** 18n;

const pretty = (E: typeof import("ethers"), wei: bigint) => {
  const num = Number(E.ethers.formatUnits(wei, 18));
  if (num >= 1_000_000)
    return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 2)} M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(num >= 100_000 ? 0 : 1)} K`;
  return num.toFixed(0);
};

const pct = (part: bigint, total: bigint) =>
  total === 0n ? "—" : `${(Number((part * 1000n) / total) / 10).toFixed(1)} %`;

const sendTelegram = async (token: string, chat_id: string, text: string) => {
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id,
      text,
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("Telegram error:", (err as any)?.response?.data ?? err);
  }
};

export const handler = async () => {
  try {
    const { E, dp, ALERT_THRESHOLD } = await ensureChain();

    const results = await Promise.all(
      WATCH_LIST.map(async ({ name, address }) => {
        const [current, caps] = await Promise.all([
          dp.getATokenTotalSupply(address),
          dp.getReserveCaps(address),
        ]);
        const rawSupplyCap = caps[1];
        const capWei = rawSupplyCap * UNIT;

        const available =
          rawSupplyCap === 0n ? 0n : capWei > current ? capWei - current : 0n;

        const alert = available >= ALERT_THRESHOLD;
        const bot = alert ? BOTS.true : BOTS.false;

        const msg =
          `*${name}*\n` +
          `• Total supply: *${pretty(E, current)}*\n` +
          (rawSupplyCap === 0n
            ? "• Cap: ∞\n"
            : `• Cap: *${pretty(E, capWei)}*\n`) +
          `• Available: *${pretty(E, available)}* (${pct(available, capWei)} free)\n` +
          (alert
            ? "⚠️ *Alert* – ≥ " +
              pretty(E, ALERT_THRESHOLD) +
              " tokens available!"
            : "✅ No alert – less than " +
              pretty(E, ALERT_THRESHOLD) +
              " available.");

        await sendTelegram(bot.token, bot.chat_id, msg);

        return {
          name,
          current: current.toString(),
          supplyCap: capWei.toString(),
          available: available.toString(),
          alert,
        };
      })
    );

    return { statusCode: 200, body: JSON.stringify(results, null, 2) };
  } catch (error) {
    console.error("Handler error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify(
        { error: error instanceof Error ? error.message : "Unknown error" },
        null,
        2
      ),
    };
  }
};
