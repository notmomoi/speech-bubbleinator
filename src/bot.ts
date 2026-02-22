import { Client, GatewayIntentBits } from 'discord.js';

import config from '@/utils/config';
import logger from '@/utils/logger';
import { loadCommands } from './utils/loaders/commands';
import { loadEvents } from './utils/loaders/events';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

(async () => {
  logger.info('Iniciando bot...');

  logger.info('Cargando comandos...');
  await loadCommands(client, './src/commands');

  logger.info('Cargando eventos...');
  await loadEvents(client, './src/events');

  logger.info('Conectando a Discord...');
  try {
    await client.login(config.token);
    logger.info('Bot conectado correctamente');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Fallo login del bot',
    );
  }
})();

process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  logger.error(error);
});
