import 'dotenv/config';
import { createPublicClient, createWalletClient, http, parseEther, } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import TelegramBot from 'node-telegram-bot-api';
import { setApiKey, tradeCoin } from '@zoralabs/coins-sdk';
// ---------- ENV ----------
function requireEnv(name) {
    const v = process.env[name];
    if (!v || !String(v).trim()) {
        // Fail fast with a clear message instead of crashing later
        console.error(`Missing required env: ${name}`);
        process.exit(1);
    }
    return String(v).trim();
}
function normalizePrivateKey(raw) {
    let k = raw.trim();
    // Accept with or without 0x prefix
    if (!k.startsWith('0x') && !k.startsWith('0X'))
        k = `0x${k}`;
    // Basic sanity checks: 0x + 64 hex chars
    if (!(k.length === 66 && /^0x[0-9a-fA-F]{64}$/.test(k))) {
        console.error('PRIVATE_KEY must be 0x-prefixed 64-hex string.');
        process.exit(1);
    }
    return k;
}
const ZORA_API_KEY = requireEnv('ZORA_API_KEY');
const PRIV = normalizePrivateKey(requireEnv('PRIVATE_KEY'));
const HTTP_RPC = requireEnv('BASE_HTTP_RPC');
const TARGET = requireEnv('TARGET_WALLET'); // ENS veya adres
const AUTOBUY_ETH = parseFloat(process.env.AUTOBUY_ETH || '0.001');
const TG_TOKEN = requireEnv('TELEGRAM_BOT_TOKEN');
const TG_DEST = (() => {
    const v = process.env.TELEGRAM_CHANNEL || process.env.TELEGRAM_CHAT_ID;
    if (!v || !String(v).trim()) {
        console.error('Missing required env: TELEGRAM_CHANNEL or TELEGRAM_CHAT_ID');
        process.exit(1);
    }
    return String(v).trim();
})();
// ---------- Clients ----------
setApiKey(ZORA_API_KEY);
const account = privateKeyToAccount(PRIV);
const publicClient = createPublicClient({ chain: base, transport: http(HTTP_RPC) });
const walletClient = createWalletClient({ chain: base, transport: http(HTTP_RPC), account });
const bot = new TelegramBot(TG_TOKEN, { polling: false });
function normalizeDest(idOrUsername) {
    if (!idOrUsername)
        return idOrUsername;
    if (idOrUsername.startsWith('@'))
        return idOrUsername;
    if (idOrUsername.startsWith('-100'))
        return idOrUsername;
    return `@${idOrUsername}`;
}
async function notify(msg) {
    try {
        await bot.sendMessage(normalizeDest(TG_DEST), msg, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
        });
    }
    catch (err) {
        console.error('Telegram error', err);
    }
}
// ---------- Zora API’den profil çek ----------
async function getProfile(identifier) {
    const res = await fetch(`https://api-sdk.zora.engineering/profile?identifier=${identifier}`, {
        headers: {
            accept: 'application/json',
            ...(ZORA_API_KEY && { 'x-api-key': ZORA_API_KEY }),
        },
    });
    if (!res.ok) {
        throw new Error(`Zora API error: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json());
    return json.profile ?? null;
}
// 👇 en son alınan coin adresini burada tutacağız
let lastBoughtCoin = null;
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
            await notify(`🚀 Creator Coin bulundu!\n` +
                `• Coin: ${coin}\n` +
                `• Name: ${name}\n` +
                `• Market Cap: ${profile.creatorCoin.marketCap}`);
            // ETH → CreatorCoin swap
            try {
                const amountIn = parseEther(AUTOBUY_ETH.toString());
                await notify(`🤖 Otomatik alım: ${AUTOBUY_ETH} ETH → ${symbol}`);
                const receipt = await tradeCoin({
                    tradeParameters: {
                        sell: { type: 'eth' },
                        buy: { type: 'erc20', address: coin },
                        amountIn,
                        slippage: 0.6,
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
            }
            catch (err) {
                await notify(`❌ Alım hata: ${err?.message || err}`);
            }
        }
        else {
            await notify(`👤 ${TARGET} için Creator Coin bulunamadı.`);
        }
    }
    catch (err) {
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
process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled Rejection:', reason);
    await notify(`❌ Unhandled Rejection: ${JSON.stringify(reason)}`);
});
process.on('uncaughtException', async (err) => {
    console.error('Uncaught Exception:', err);
    await notify(`❌ Uncaught Exception: ${JSON.stringify(err)}`);
});
main();
//# sourceMappingURL=index.js.map