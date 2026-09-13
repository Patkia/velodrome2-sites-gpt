export type TelegramNotifierOptions = {
  botToken?: string;
  chatId?: string;
  fetchImpl?: typeof fetch;
};

export type TelegramSendResult = {
  sent: boolean;
  errorCode?: "TELEGRAM_UNAVAILABLE" | "TELEGRAM_SEND_FAILED";
};

export function isTelegramConfigured(options: TelegramNotifierOptions): boolean {
  return Boolean(options.botToken && options.chatId);
}

export async function sendTelegramMessage(
  message: string,
  options: TelegramNotifierOptions,
): Promise<TelegramSendResult> {
  if (!isTelegramConfigured(options)) {
    return { sent: false, errorCode: "TELEGRAM_UNAVAILABLE" };
  }

  const body = new FormData();
  body.set("chat_id", options.chatId!);
  body.set("text", message);
  body.set("parse_mode", "HTML");

  try {
    const response = await (options.fetchImpl ?? fetch)(
      `https://api.telegram.org/bot${options.botToken}/sendMessage`,
      { method: "POST", body },
    );

    if (!response.ok) {
      return { sent: false, errorCode: "TELEGRAM_SEND_FAILED" };
    }

    return { sent: true };
  } catch {
    return { sent: false, errorCode: "TELEGRAM_SEND_FAILED" };
  }
}
