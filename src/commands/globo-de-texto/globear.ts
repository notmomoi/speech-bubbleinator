import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import logger from '@/utils/logger';
import { resolveMedia } from '@/utils/media';
import { applySpeechBubble } from '@/utils/speechBubble';
import type { Command } from '@/utils/types/command';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('globo-de-texto')
    .setDescription('cuidado, por aca globean a los pibes!')
    .addAttachmentOption((option) =>
      option
        .setName('archivo')
        .setDescription('imagen, gif o video para globear')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('link')
        .setDescription('link directo a imagen, gif o video')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const attachment = interaction.options.getAttachment('archivo');
      const link = interaction.options.getString('link');

      logger.info(
        {
          commandName: interaction.commandName,
          guildId: interaction.guildId,
          hasAttachment: Boolean(attachment),
          hasLink: Boolean(link),
        },
        'Invocacion slash de globear',
      );

      const media = await resolveMedia({
        attachment,
        link,
      });

      const processed = await applySpeechBubble(media, {
        maxOutputBytes: interaction.attachmentSizeLimit,
      });

      await interaction.editReply({
        files: [
          new AttachmentBuilder(processed.buffer, { name: processed.filename }),
        ],
      });

      logger.info(
        {
          commandName: interaction.commandName,
          outputBytes: processed.buffer.length,
        },
        'Slash globear completado',
      );
    } catch (error) {
      logger.warn(
        {
          commandName: interaction.commandName,
          error: error instanceof Error ? error.message : String(error),
        },
        'Fallo slash globear',
      );

      const message =
        error instanceof Error
          ? error.message
          : 'No pude procesar ese archivo. Intenta con otra media.';

      await interaction.editReply({ content: message });
    }
  },
};
