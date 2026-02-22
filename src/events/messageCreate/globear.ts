import { AttachmentBuilder, Events } from 'discord.js';
import logger from '@/utils/logger';
import { resolveMedia } from '@/utils/media';
import { applySpeechBubble } from '@/utils/speechBubble';
import type { Event } from '@/utils/types/event';

const PREFIX = '-';
const COMMANDS = new Set(['globo-de-sexo', 'globear']);
const DEFAULT_UPLOAD_LIMIT = 10 * 1024 * 1024;
const PREMIUM_TIER_UPLOAD_LIMITS: Record<number, number> = {
  0: 10 * 1024 * 1024,
  1: 10 * 1024 * 1024,
  2: 50 * 1024 * 1024,
  3: 100 * 1024 * 1024,
};

const isHttpUrl = (value: string) =>
  value.startsWith('http://') || value.startsWith('https://');

const resolveRuntimeUploadLimit = (premiumTier?: number): number => {
  if (premiumTier === undefined || premiumTier === null) {
    return DEFAULT_UPLOAD_LIMIT;
  }

  return PREMIUM_TIER_UPLOAD_LIMITS[premiumTier] ?? DEFAULT_UPLOAD_LIMIT;
};

const firstLinkArg = (args: string[]) => {
  for (const arg of args) {
    if (isHttpUrl(arg)) {
      return arg;
    }
  }

  return null;
};

export const event: Event<Events.MessageCreate> = {
  name: Events.MessageCreate,

  async execute(message) {
    if (message.author.bot) return;

    const content = message.content.trim();
    if (!content.startsWith(PREFIX)) return;

    const withoutPrefix = content.slice(PREFIX.length).trim();
    let link: string | null = null;
    let triggerSource: 'bare' | 'alias' | 'direct-url' = 'bare';

    if (withoutPrefix.length > 0) {
      const [rawToken, ...args] = withoutPrefix.split(/\s+/);
      const token = rawToken?.toLowerCase() ?? '';

      if (COMMANDS.has(token)) {
        link = firstLinkArg(args);
        triggerSource = 'alias';
      } else if (isHttpUrl(rawToken ?? '')) {
        link = rawToken ?? null;
        triggerSource = 'direct-url';
      } else {
        return;
      }
    }

    logger.info(
      {
        source: triggerSource,
        guildId: message.guildId,
        hasAttachment: message.attachments.size > 0,
        hasReference: Boolean(message.reference?.messageId),
      },
      'Trigger de globear detectado',
    );

    try {
      const media = await resolveMedia({
        link,
        message,
      });

      const processed = await applySpeechBubble(media, {
        maxOutputBytes: resolveRuntimeUploadLimit(message.guild?.premiumTier),
      });

      await message.reply({
        files: [
          new AttachmentBuilder(processed.buffer, { name: processed.filename }),
        ],
      });

      logger.info(
        {
          source: triggerSource,
          outputBytes: processed.buffer.length,
        },
        'Globear completado desde mensaje',
      );

      await message.delete().catch((error) => {
        logger.warn(
          {
            messageId: message.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'No pude borrar el mensaje trigger',
        );
      });
    } catch (error) {
      logger.warn(
        {
          source: triggerSource,
          error: error instanceof Error ? error.message : String(error),
        },
        'Fallo globear desde mensaje',
      );

      const response =
        error instanceof Error
          ? error.message
          : 'No pude procesar esa media. Intenta con otro archivo.';

      await message.reply(response);
    }
  },
};
