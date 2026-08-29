import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

async function sendMessage(chatId: number, text: string): Promise<void> {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

// POST /webhook/telegram - Telegram sends updates here
export const POST: RequestHandler = async (event) => {
  // Always respond 200 to Telegram immediately
  const body = await event.request.json();

  // Process in background (non-blocking)
  try {
    const message = body?.message;
    if (!message?.text || !message?.chat?.id) return json({ ok: true });

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === "/start" || text === "/chatid") {
      const firstName = message.from?.first_name || "there";
      await sendMessage(chatId,
        `Hey ${firstName}!\n\n` +
        `Your chat ID is: <code>${chatId}</code>\n\n` +
        `Copy this number and paste it into the Dashboard channel settings to receive alerts here.`
      );
    }
  } catch (err: any) {
    console.error("[telegram-bot] Error handling update:", err.message);
  }

  return json({ ok: true });
};
