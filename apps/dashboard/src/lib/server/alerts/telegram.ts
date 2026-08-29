import { config } from "../config.js";

const ADMIN_TELEGRAM_API = () => `https://api.telegram.org/bot${config.telegram.botToken}`;

// Send to admin (internal alerts)
export async function sendAlert(message: string): Promise<void> {
  const botToken = config.telegram.botToken;
  const chatId = config.telegram.chatId;
  if (!botToken || !chatId) return;

  try {
    await fetch(`${ADMIN_TELEGRAM_API()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch (err: any) {
    console.error(`Telegram alert failed: ${err.message}`);
  }
}

// Send using any bot token to any chat
export async function sendTelegramMessage(botToken: string, chatId: string, message: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
    return resp.ok;
  } catch (err: any) {
    console.error(`Telegram message failed: ${err.message}`);
    return false;
  }
}
