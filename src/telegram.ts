import { HttpError } from 'grammy';
import { Api, Bot, InputFile } from 'grammy';
import { parseCommand } from './command';
import type { Deps } from './execute';
import { execute } from './execute';
import { describeError, log } from './log';
import { FAILED_REPLY } from './text';

/** Hanya chat pribadi dari Pengguna terdaftar (FR-001–FR-003, D10). */
export function isAllowedMessage(
  chatType: string | undefined,
  fromId: number | undefined,
  allowedUserIds: readonly number[],
): boolean {
  return chatType === 'private' && fromId !== undefined && allowedUserIds.includes(fromId);
}

/**
 * Adapter Telegram: pesan → command → execute → balasan. Tanpa logika uang.
 * `makeDeps` dipanggil per pesan dengan id pengirim, mengikat repo ke bukunya (ADR-0007).
 */
export function createBot(token: string, allowedUserIds: readonly number[], makeDeps: (owner: number) => Deps): Bot {
  const bot = new Bot(token);

  bot.use(async (ctx, next) => {
    if (!isAllowedMessage(ctx.chat?.type, ctx.from?.id, allowedUserIds)) return;
    await next();
  });

  bot.on('message', async (ctx) => {
    const user = ctx.from!.id;
    const deps = makeDeps(user);
    const command = parseCommand(ctx.message.text ?? '');
    const cmd = command?.name ?? 'none';
    log('info', 'command', { user, cmd });

    try {
      const reply = await execute(command, deps);
      // Dipisah dari `execute` agar gagal kirim (DB sudah tertulis) tidak dilog sebagai command_failed.
      try {
        if (typeof reply === 'string') {
          await ctx.reply(reply, { parse_mode: 'HTML' });
        } else {
          const file = new InputFile(Buffer.from(reply.content, 'utf8'), reply.filename);
          await ctx.replyWithDocument(file, { caption: reply.caption, parse_mode: 'HTML' });
        }
      } catch (error) {
        log('error', 'reply_failed', { user, cmd, error: describeError(error, token) });
        // Teks statis tanpa data pengguna: aman dikirim meski balasan asli gagal di-parse Telegram.
        await ctx.reply(FAILED_REPLY, { parse_mode: 'HTML' }).catch(() => {});
      }
    } catch (error) {
      log('error', 'command_failed', { user, cmd, error: describeError(error, token) });
      await ctx.reply(FAILED_REPLY, { parse_mode: 'HTML' });
    }
  });

  bot.catch((error) => {
    const user = error.ctx.from?.id;
    const fields: Record<string, string | number> = { error: describeError(error.error, token) };
    if (user !== undefined) fields.user = user;
    log('error', 'update_failed', fields);
  });

  return bot;
}

/**
 * getMe dengan satu percobaan ulang untuk kegagalan jaringan transien (HttpError,
 * mis. ECONNRESET saat handshake). GrammyError = Telegram menjawab (mis. token
 * salah) → tidak di-retry. Tidak ada loop: Heroku restart sendiri bila tetap gagal.
 */
export async function getMeWithRetry(api: Api): Promise<unknown> {
  try {
    return await api.getMe();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    log('warn', 'startup_retry', { error: describeError(error) });
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return api.getMe();
  }
}

// Satu percobaan ulang saja; Heroku restart otomatis bila tetap gagal.
const RETRY_DELAY_MS = 1500;
