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

const WATCH_LIST = parseJsonEnv<WatchedAsset[]>("WATCH_LIST");
const ALERT_THRESHOLD = ethers.parseUnits(
  getEnvVar("ALERT_THRESHOLD_TOKENS"),
  18
);

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
    const assetsPromise = Promise.all(
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

    const [assets, pendle] = await Promise.all([
      assetsPromise,
      checkPendleAndNotify(),
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({ assets, pendle }, null, 2),
    };
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

/* ─────────── Pendle alert (runs once per invocation) ─────────── */

const PENDLE = {
  url: "https://api-v2.pendle.finance/bff/v2/markets/all?isActive=true",
  marketAddress: "0xa36b60a14a1a5247912584768c6e53e1a269a9f7",
  cap: 2_500_000_000,
  threshold: 500_000,
};

const pendleHuman = (num: number) => {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${Math.round(num / 1_000)}K`;
  return num.toString();
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getPendleAvailable = async (): Promise<number> => {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://app.pendle.finance",
    Referer: "https://app.pendle.finance/",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };

  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const { data } = await axios.get(
        "https://api-v2.pendle.finance/bff/v2/markets/all?isActive=true",
        { timeout: 10_000, headers }
      );

      const results = (data as any)?.results as any[] | undefined;
      if (!Array.isArray(results)) throw new Error("Invalid Pendle response");

      const mkt = results.find(
        (r) =>
          typeof r?.address === "string" &&
          r.address.toLowerCase() === PENDLE.marketAddress.toLowerCase()
      );
      if (!mkt) throw new Error("Pendle market not found");

      const current = Number(mkt?.extendedInfo?.syCurrentSupply ?? NaN);
      if (!Number.isFinite(current)) throw new Error("Invalid syCurrentSupply");

      return Math.max(0, PENDLE.cap - current); // keep cap hardcoded
    } catch (e) {
      lastErr = e;
      if (i < 2) await sleep(200 * 2 ** i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
};

const checkPendleAndNotify = async () => {
  try {
    const available = await getPendleAvailable();
    const alerted = available > PENDLE.threshold;

    if (alerted) {
      const title = "Available sUSDe in Pendle";
      const text = `It is ${pendleHuman(available)} now`;
      await sendTelegram(
        BOTS.true.token,
        BOTS.true.chat_id,
        `*${title}*\n${text}`
      );
    }

    return { available, alerted };
  } catch (e) {
    const msg =
      "Pendle check error: " + (e instanceof Error ? e.message : String(e));
    await sendTelegram(BOTS.false.token, BOTS.false.chat_id, msg);
    return { error: true as const };
  }
};
