import { Bot, InputFile } from 'grammy';
import { parseCommand } from './command';
import type { Deps } from './execute';
import { execute } from './execute';
import { describeError, log } from './log';

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
      if (typeof reply === 'string') {
        await ctx.reply(reply, { parse_mode: 'HTML' });
      } else {
        const file = new InputFile(Buffer.from(reply.content, 'utf8'), reply.filename);
        await ctx.replyWithDocument(file, { caption: reply.caption, parse_mode: 'HTML' });
      }
    } catch (error) {
      log('error', 'command_failed', { user, cmd, error: describeError(error, token) });
      await ctx.reply('⚠️ <b>Terjadi kesalahan saat memproses command.</b>\n\nCoba lagi.', { parse_mode: 'HTML' });
    }
  });

  bot.catch((error) => {
    log('error', 'update_failed', { error: describeError(error.error, token) });
  });

  return bot;
}
