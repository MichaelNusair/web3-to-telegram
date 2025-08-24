import { ethers } from "ethers";
import axios from "axios";

/* ───────────── Types ───────────── */

interface WatchedAsset {
  name: string;
  address: string;
}

/* ───────────── Configuration ───────────── */

const getEnvVar = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value;
};

const parseJsonEnv = <T>(name: string): T => {
  const jsonString = getEnvVar(name);
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    throw new Error(`Failed to parse ${name} as JSON: ${error}`);
  }
};

// Load configuration from environment variables
const RPC_URL = getEnvVar("RPC_URL");
const DATA_PROVIDER = getEnvVar("DATA_PROVIDER_ADDRESS");

// Bot configuration - 4 simple environment variables
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

const WATCH_LIST = [
  {
    name: "PT USDe September 2025",
    address: "0xbc6736d346a5ebc0debc997397912cd9b8fae10a",
  },
  {
    name: "PT sUSDe September",
    address: "0x9f56094c450763769ba0ea9fe2876070c0fd5f77",
  },
];

const ALERT_THRESHOLD = ethers.parseUnits("50000", 18);

/* ─────────── Chain interfaces ────────── */

const ABI = [
  "function getATokenTotalSupply(address) view returns (uint256)",
  "function getReserveCaps(address) view returns (uint256 borrowCap, uint256 supplyCap)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const dp = new ethers.Contract(DATA_PROVIDER, ABI, provider);

const UNIT = 10n ** 18n;

/* ──────────── Helpers ─────────────── */

/** 1 234 567 ⟶ "1.23 M"  |  23 500 ⟶ "23.5 K" */
const pretty = (wei: bigint) => {
  const num = Number(ethers.formatUnits(wei, 18));
  if (num >= 1_000_000)
    return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 2)} M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(num >= 100_000 ? 0 : 1)} K`;
  return num.toFixed(0);
};

/** percentage with one decimal, or "—" if cap = 0 */
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
    // eslint-disable-next-line no-console
    console.error(
      "Telegram error:",
      typeof err === "object" &&
        err !== null &&
        "response" in err &&
        typeof err.response === "object" &&
        err.response !== null &&
        "data" in err.response
        ? err.response?.data
        : err
    );
  }
};

/* ───────────── Lambda entry ─────────── */

export const handler = async () => {
  try {
    const results = await Promise.all(
      WATCH_LIST.map(async ({ name, address }) => {
        /* fetch current supply & cap */
        const [current, caps] = await Promise.all([
          dp.getATokenTotalSupply(address),
          dp.getReserveCaps(address),
        ]);
        const rawSupplyCap = caps[1]; // whole tokens
        const capWei = rawSupplyCap * UNIT; // convert to wei

        /* calculate free capacity */
        const available =
          rawSupplyCap === 0n ? 0n : capWei > current ? capWei - current : 0n;

        /* alert logic */
        const alert = available >= ALERT_THRESHOLD;
        const bot = alert ? BOTS.true : BOTS.false;

        /* message */
        const msg =
          `*${name}*\n` +
          `• Total supply: *${pretty(current)}*\n` +
          (rawSupplyCap === 0n
            ? "• Cap: ∞\n"
            : `• Cap: *${pretty(capWei)}*\n`) +
          `• Available: *${pretty(available)}* (${pct(
            available,
            capWei
          )} free)\n` +
          (alert
            ? "⚠️ *Alert* – ≥ " + pretty(ALERT_THRESHOLD) + " tokens available!"
            : "✅ No alert – less than " +
              pretty(ALERT_THRESHOLD) +
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
