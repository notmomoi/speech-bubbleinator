import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import logger from '@/utils/logger';
import type { ResolvedMedia } from '@/utils/media';

const BUBBLE_ASSET_PATH = fileURLToPath(
  new URL('../assets/image.png', import.meta.url),
);

const BUBBLE_BUFFER_PROMISE = readFile(BUBBLE_ASSET_PATH);
const BUBBLE_METADATA_PROMISE = sharp(BUBBLE_ASSET_PATH).metadata();
const FFMPEG_TIMEOUT_MS = 45_000;
const BUBBLE_WIDTH_RATIO = 0.96;
const BUBBLE_TOP_MARGIN_RATIO = 0.02;
const BUBBLE_TOP_MARGIN_MIN = 6;
const HEADER_BREATHING_RATIO = 0.04;
const HEADER_BREATHING_MIN = 16;

export interface SpeechBubbleResult {
  buffer: Buffer;
  filename: string;
}

interface ApplySpeechBubbleOptions {
  maxOutputBytes?: number;
}

interface GifEncodingProfile {
  fps: number;
  scale: number;
  colors: number;
}

interface VideoEncodingProfile {
  fps: number;
  scale: number;
  crf: number;
}

const GIF_ENCODING_PROFILES: GifEncodingProfile[] = [
  { fps: 22, scale: 1, colors: 256 },
  { fps: 18, scale: 0.9, colors: 192 },
  { fps: 15, scale: 0.8, colors: 128 },
  { fps: 12, scale: 0.7, colors: 96 },
];

const VIDEO_ENCODING_PROFILES: VideoEncodingProfile[] = [
  { fps: 30, scale: 1, crf: 23 },
  { fps: 24, scale: 0.9, crf: 27 },
  { fps: 20, scale: 0.8, crf: 30 },
  { fps: 15, scale: 0.7, crf: 34 },
];

const outputFilename = (input: ResolvedMedia, extension: string) => {
  const base = path.parse(input.filename).name || 'media';
  return `${base}-globear.${extension}`;
};

const getBubbleAspectRatio = async (): Promise<number> => {
  const metadata = await BUBBLE_METADATA_PROMISE;

  if (!metadata.width || !metadata.height) {
    throw new Error('No pude leer el asset del globo.');
  }

  return metadata.height / metadata.width;
};

const runFfmpeg = async (args: string[], stage: string): Promise<void> => {
  logger.debug({ stage }, 'Iniciando ffmpeg');

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      logger.warn({ stage, timeoutMs: FFMPEG_TIMEOUT_MS }, 'Timeout en ffmpeg');
      reject(new Error('El procesamiento tardo demasiado.'));
    }, FFMPEG_TIMEOUT_MS);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.error({ stage }, 'ffmpeg no esta instalado');
        reject(
          new Error(
            'ffmpeg no esta disponible en el servidor. No puedo procesar gifs/videos.',
          ),
        );
        return;
      }

      logger.error(
        {
          stage,
          error: error instanceof Error ? error.message : String(error),
        },
        'Fallo inesperado al ejecutar ffmpeg',
      );
      reject(error);
    });

    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code === 0) {
        resolve();
        return;
      }

      const details = stderr.trim();
      logger.warn(
        {
          stage,
          code,
          details: details.slice(0, 500),
        },
        'ffmpeg termino con error',
      );
      reject(
        new Error(
          details
            ? `ffmpeg fallo al procesar el archivo: ${details}`
            : 'ffmpeg fallo al procesar el archivo.',
        ),
      );
    });
  });
};

const isWithinLimit = (buffer: Buffer, maxOutputBytes?: number): boolean =>
  !maxOutputBytes || buffer.length <= maxOutputBytes;

const tooLargeError = (maxOutputBytes: number): Error =>
  new Error(
    `El archivo sigue superando el limite de ${Math.floor(maxOutputBytes / 1024 / 1024)}MB incluso despues de comprimirlo.`,
  );

const processImage = async (
  input: ResolvedMedia,
): Promise<SpeechBubbleResult> => {
  logger.info(
    { kind: input.kind, size: input.size },
    'Procesando imagen estatica',
  );

  const image = sharp(input.buffer, { failOn: 'none' });
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('No pude leer las dimensiones de la imagen.');
  }

  const bubbleAspectRatio = await getBubbleAspectRatio();
  const bubbleWidth = Math.max(
    120,
    Math.round(metadata.width * BUBBLE_WIDTH_RATIO),
  );
  const bubbleHeight = Math.max(
    24,
    Math.round(bubbleWidth * bubbleAspectRatio),
  );
  const bubbleTop = Math.max(
    BUBBLE_TOP_MARGIN_MIN,
    Math.round(metadata.height * BUBBLE_TOP_MARGIN_RATIO),
  );
  const headerBreathingRoom = Math.max(
    HEADER_BREATHING_MIN,
    Math.round(metadata.height * HEADER_BREATHING_RATIO),
  );
  const topPadding = bubbleTop + bubbleHeight + headerBreathingRoom;
  const left = Math.round((metadata.width - bubbleWidth) / 2);
  const bubbleOverlay = await sharp(await BUBBLE_BUFFER_PROMISE)
    .resize({
      width: bubbleWidth,
      height: bubbleHeight,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
  const baseImage = await image.png().toBuffer();

  const buffer = await sharp({
    create: {
      width: metadata.width,
      height: metadata.height + topPadding,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: bubbleOverlay, left, top: bubbleTop },
      { input: baseImage, left: 0, top: topPadding },
    ])
    .gif({ effort: 7, reuse: true })
    .toBuffer();

  logger.info({ outputSize: buffer.length }, 'Imagen estatica procesada');

  return {
    buffer,
    filename: outputFilename(input, 'gif'),
  };
};

const processAnimatedOrVideo = async (
  input: ResolvedMedia,
  options?: ApplySpeechBubbleOptions,
): Promise<SpeechBubbleResult> => {
  logger.info(
    { kind: input.kind, size: input.size },
    'Procesando media animada/video',
  );

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'globear-'));
  const inputPath = path.join(tempDir, `input.${input.extension || 'bin'}`);
  const outputExtension = input.kind === 'gif' ? 'gif' : 'mp4';
  const outputPath = path.join(
    tempDir,
    `output-${Date.now()}.${outputExtension}`,
  );
  const bubblePath = path.join(tempDir, 'bubble.png');
  const bubbleAspectRatio = await getBubbleAspectRatio();
  const bubbleHeightExpr = `${(BUBBLE_WIDTH_RATIO * bubbleAspectRatio).toFixed(8)}*iw`;
  const bubbleTopPadExpr = `max(${BUBBLE_TOP_MARGIN_MIN}\\,ih*${BUBBLE_TOP_MARGIN_RATIO})`;
  const bubbleTopOverlayExpr = `${BUBBLE_TOP_MARGIN_MIN}`;
  const headerBreathingExpr = `max(${HEADER_BREATHING_MIN}\\,ih*${HEADER_BREATHING_RATIO})`;
  const topPaddingExpr = `${bubbleHeightExpr}+${bubbleTopPadExpr}+${headerBreathingExpr}`;
  const overlayGraph =
    `[1:v][0:v]scale2ref=w=iw*${BUBBLE_WIDTH_RATIO}:h=ow/mdar:flags=lanczos[bubble][base];` +
    `[base]pad=w=iw:h=ih+${topPaddingExpr}:x=0:y=${topPaddingExpr}:color=white[padded];` +
    `[padded][bubble]overlay=x=(W-w)/2:y=${bubbleTopOverlayExpr}:format=auto:shortest=0:eof_action=repeat[overlayed]`;

  const encodeGifWithProfiles = async (
    maxOutputBytes?: number,
  ): Promise<Buffer> => {
    for (const profile of GIF_ENCODING_PROFILES) {
      logger.info({ profile, maxOutputBytes }, 'Intentando perfil GIF');
      const filterComplex =
        `${overlayGraph};` +
        `[overlayed]fps=${profile.fps},scale=iw*${profile.scale}:-1:flags=lanczos,split[palette_source][gif_source];` +
        `[palette_source]palettegen=max_colors=${profile.colors}:stats_mode=diff[palette];` +
        `[gif_source][palette]paletteuse=dither=sierra2_4a[v]`;

      await runFfmpeg(
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          inputPath,
          '-i',
          bubblePath,
          '-filter_complex',
          filterComplex,
          '-map',
          '[v]',
          outputPath,
        ],
        `gif-fps-${profile.fps}-scale-${profile.scale}`,
      );

      const buffer = await readFile(outputPath);
      if (isWithinLimit(buffer, maxOutputBytes)) {
        logger.info(
          { profile, outputSize: buffer.length, maxOutputBytes },
          'Perfil GIF aceptado',
        );
        return buffer;
      }

      logger.warn(
        { profile, outputSize: buffer.length, maxOutputBytes },
        'Perfil GIF supera limite, reintentando',
      );
    }

    throw maxOutputBytes
      ? tooLargeError(maxOutputBytes)
      : new Error('No pude comprimir el gif procesado.');
  };

  const encodeVideoWithProfiles = async (
    maxOutputBytes?: number,
  ): Promise<Buffer> => {
    for (const profile of VIDEO_ENCODING_PROFILES) {
      logger.info({ profile, maxOutputBytes }, 'Intentando perfil MP4');
      const filterComplex =
        `${overlayGraph};` +
        `[overlayed]fps=${profile.fps},scale=iw*${profile.scale}:-2:flags=lanczos[v]`;

      await runFfmpeg(
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          inputPath,
          '-i',
          bubblePath,
          '-filter_complex',
          filterComplex,
          '-map',
          '[v]',
          '-map',
          '0:a?',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          String(profile.crf),
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          outputPath,
        ],
        `mp4-fps-${profile.fps}-scale-${profile.scale}-crf-${profile.crf}`,
      );

      const buffer = await readFile(outputPath);
      if (isWithinLimit(buffer, maxOutputBytes)) {
        logger.info(
          { profile, outputSize: buffer.length, maxOutputBytes },
          'Perfil MP4 aceptado',
        );
        return buffer;
      }

      logger.warn(
        { profile, outputSize: buffer.length, maxOutputBytes },
        'Perfil MP4 supera limite, reintentando',
      );
    }

    throw maxOutputBytes
      ? tooLargeError(maxOutputBytes)
      : new Error('No pude comprimir el video procesado.');
  };

  try {
    await Promise.all([
      writeFile(inputPath, input.buffer),
      writeFile(bubblePath, await BUBBLE_BUFFER_PROMISE),
    ]);

    const maxOutputBytes = options?.maxOutputBytes;
    const buffer =
      input.kind === 'gif'
        ? await encodeGifWithProfiles(maxOutputBytes)
        : await encodeVideoWithProfiles(maxOutputBytes);

    logger.info(
      {
        kind: input.kind,
        outputSize: buffer.length,
        maxOutputBytes,
      },
      'Media animada/video procesada',
    );

    return {
      buffer,
      filename: outputFilename(input, outputExtension),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

export const applySpeechBubble = async (
  input: ResolvedMedia,
  options?: ApplySpeechBubbleOptions,
): Promise<SpeechBubbleResult> => {
  if (input.kind === 'image') {
    return processImage(input);
  }

  return processAnimatedOrVideo(input, options);
};
