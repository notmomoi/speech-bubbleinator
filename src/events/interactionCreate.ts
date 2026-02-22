import { Events, MessageFlags } from 'discord.js';
import { Cooldown } from '@/utils/cooldown';
import logger from '@/utils/logger';
import type { Event } from '@/utils/types/event';

const cooldown = new Cooldown(3);

export const event: Event<Events.InteractionCreate> = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    if (cooldown.check(interaction.user.id)) {
      const remaining = cooldown.getRemainingTime(interaction.user.id);

      await interaction.reply({
        content: `Please wait ${remaining}s before using the command again`,
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
      logger.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }

    cooldown.set(interaction.user.id);

    try {
      logger.info(
        {
          commandName: interaction.commandName,
          userId: interaction.user.id,
          guildId: interaction.guildId,
        },
        'Ejecutando comando slash',
      );

      await command.execute(interaction);
    } catch (error) {
      logger.error(
        {
          commandName: interaction.commandName,
          userId: interaction.user.id,
          guildId: interaction.guildId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error al ejecutar comando slash',
      );

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: 'There was an error while executing this command.',
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: 'There was an error while executing this command.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
