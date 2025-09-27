import 'dotenv/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import TelegramBot from 'node-telegram-bot-api';
import { setApiKey, tradeCoin } from '@zoralabs/coins-sdk';

// ---------- ENV ----------
const ZORA_API_KEY = process.env.ZORA_API_KEY!;
const PRIV = process.env.PRIVATE_KEY!;
const HTTP_RPC = process.env.BASE_HTTP_RPC!;
const TARGET = process.env.TARGET_WALLET!; // ENS veya adres
const AUTOBUY_ETH = parseFloat(process.env.AUTOBUY_ETH || '0.001');
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TG_DEST = (process.env.TELEGRAM_CHANNEL || process.env.TELEGRAM_CHAT_ID)!;
interface CreatorCoin {
  address: string;
  symbol: string;
  name: string;
  marketCap: string; // Assuming marketCap is a string, adjust if it's a number
}

interface Profile {
  displayName?: string;
  handle?: string;
  creatorCoin?: CreatorCoin;
}// ... tüm importlar ve ENV aynı

// ---------- Clients ----------
setApiKey(ZORA_API_KEY);

const account = privateKeyToAccount(PRIV as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http(HTTP_RPC) });
const walletClient = createWalletClient({ chain: base, transport: http(HTTP_RPC), account });

const bot = new TelegramBot(TG_TOKEN, { polling: false });

function normalizeDest(idOrUsername: string) {
  if (!idOrUsername) return idOrUsername;
  if (idOrUsername.startsWith('@')) return idOrUsername;
  if (idOrUsername.startsWith('-100')) return idOrUsername;
  return `@${idOrUsername}`;
}

async function notify(msg: string) {
  try {
    await bot.sendMessage(normalizeDest(TG_DEST), msg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error('Telegram error', err);
  }
}

// ---------- Zora API’den profil çek ----------
async function getProfile(identifier: string): Promise<Profile | null> {
  const res = await fetch(
    `https://api-sdk.zora.engineering/profile?identifier=${identifier}`,
    {
      headers: {
        accept: 'application/json',
        ...(ZORA_API_KEY && { 'x-api-key': ZORA_API_KEY }),
      },
    },
  );
  if (!res.ok) {
    throw new Error(`Zora API error: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { profile?: Profile };
  return json.profile ?? null;
}

// 👇 en son alınan coin adresini burada tutacağız
let lastBoughtCoin: string | null = null;

// ---------- Creator Coin kontrol ve alım ----------
async function checkAndBuy() {
  try {
    const profile = await getProfile(TARGET);
    if (!profile) {
      await notify(`👤 ${TARGET} için profil bulunamadı.`);
      return;
    }

    await notify(`📄 Profil: ${profile.displayName || profile.handle}`);

    if (profile.creatorCoin) {
      const coin = profile.creatorCoin.address;
      const symbol = profile.creatorCoin.symbol || 'Unknown';
      const name = profile.creatorCoin.name || 'Unknown';
      await notify(
        `🚀 Creator Coin bulundu!\n` +
          `• Coin: ${coin}\n` +
          `• Name: ${name}\n` +
          `• Market Cap: ${profile.creatorCoin.marketCap}`,
      );

    
      // ETH → CreatorCoin swap
      try {
        const amountIn = parseEther(AUTOBUY_ETH.toString());
        await notify(`🤖 Otomatik alım: ${AUTOBUY_ETH} ETH → ${symbol}`);
        const receipt = await tradeCoin({
          tradeParameters: {
            sell: { type: 'eth' },
            buy: { type: 'erc20', address: coin },
            amountIn,
            slippage: 0.1,
            sender: account.address,
          },
          walletClient,
          account,
          publicClient,
        });
         await notify(`✅ Alım tx: https://basescan.org/tx/${receipt.transactionHash}`);

    // 👇 başarılı alımdan sonra programı bitir
    await notify('🎉 Token basariyla alindi bot kapaniyor.');
    process.exit(0);

     } catch (err: any) {
        await notify(`❌ Alım hata: ${err?.message || err}`);
      }
    } else {
      await notify(`👤 ${TARGET} için Creator Coin bulunamadı.`);
    }
  } catch (err: any) {
    console.error(err);
    await notify(`❌ Profil hata: ${err?.message || err}`);
  }
}

// ---------- Main ----------
async function main() {
  await notify('🧠 Bot başlatıldı… Creator Coin kontrolü yapılıyor');
  await checkAndBuy();
  // hâlâ her dakikada bir kontrol edebilir ama alım sadece bir kere yapılır
  setInterval(() => checkAndBuy(), 60_000);
}

process.on('unhandledRejection', async (reason: any) => {
  console.error('Unhandled Rejection:', reason);
  await notify(`❌ Unhandled Rejection: ${JSON.stringify(reason)}`);
});
process.on('uncaughtException', async (err: any) => {
  console.error('Uncaught Exception:', err);
  await notify(`❌ Uncaught Exception: ${JSON.stringify(err)}`);
});

main();
