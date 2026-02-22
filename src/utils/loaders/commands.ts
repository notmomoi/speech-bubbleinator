import { type Client, Collection } from 'discord.js';
import logger from '@/utils/logger';
import type { Command } from '../types/command';
import { getAllFiles } from './getAllFiles';

export const loadCommands = async (client: Client, dir: string) => {
  client.commands = new Collection<string, Command>();
  const commandFiles = getAllFiles(dir);
  let loadedCount = 0;

  for (const file of commandFiles) {
    const { command } = await import(file);

    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      loadedCount += 1;
    } else {
      logger.warn(`invalid command file: ${file}`);
    }
  }

  logger.info({ loadedCount }, 'Comandos cargados');
};
