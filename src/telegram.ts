import { Bot, InputFile } from 'grammy';
import { parseCommand } from './command';
import type { Deps } from './execute';
import { execute } from './execute';
import { describeError, log } from './log';

/** Hanya chat pribadi dari satu pengguna (FR-001, FR-003, D10). */
export function isAllowedMessage(
  chatType: string | undefined,
  fromId: number | undefined,
  allowedUserId: number,
): boolean {
  return chatType === 'private' && fromId === allowedUserId;
}

/** Adapter Telegram: pesan → command → execute → balasan. Tanpa logika uang. */
export function createBot(token: string, allowedUserId: number, deps: Deps): Bot {
  const bot = new Bot(token);

  bot.use(async (ctx, next) => {
    if (!isAllowedMessage(ctx.chat?.type, ctx.from?.id, allowedUserId)) return;
    await next();
  });

  bot.on('message', async (ctx) => {
    const command = parseCommand(ctx.message.text ?? '');
    const cmd = command?.name ?? 'none';
    log('info', 'command', { cmd });

    try {
      const reply = await execute(command, deps);
      if (typeof reply === 'string') {
        await ctx.reply(reply);
      } else {
        const file = new InputFile(Buffer.from(reply.content, 'utf8'), reply.filename);
        await ctx.replyWithDocument(file, { caption: reply.caption });
      }
    } catch (error) {
      log('error', 'command_failed', { cmd, error: describeError(error, token) });
      await ctx.reply('⚠️ Terjadi kesalahan saat memproses command.\nCoba lagi.');
    }
  });

  bot.catch((error) => {
    log('error', 'update_failed', { error: describeError(error.error, token) });
  });

  return bot;
}