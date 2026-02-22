import path from 'node:path';
import type { Attachment, Message } from 'discord.js';
import logger from '@/utils/logger';

type MediaKind = 'image' | 'gif' | 'video';

const LINK_PATTERN = /(https?:\/\/[^\s<>]+)/i;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_URL_RESOLVE_DEPTH = 3;

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi']);

export interface ResolvedMedia {
  buffer: Buffer;
  kind: MediaKind;
  filename: string;
  extension: string;
  size: number;
}

interface ResolveMediaOptions {
  attachment?: Attachment | null;
  link?: string | null;
  message?: Message;
}

interface ResolveUrlContext {
  depth: number;
  visited: Set<string>;
}

const sanitizeFilename = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);

const getExtension = (filename: string) =>
  path.extname(filename).replace('.', '').toLowerCase();

const parseMediaKind = (
  contentType: string | null,
  extension: string,
): MediaKind | null => {
  const mime = contentType?.toLowerCase() ?? '';

  if (mime === 'image/gif' || extension === 'gif') {
    return 'gif';
  }

  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) {
    return 'video';
  }

  if (mime.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }

  return null;
};

const readBufferWithGuard = async (
  response: Response,
  maxBytes: number,
): Promise<Buffer> => {
  const sizeHeader = response.headers.get('content-length');

  if (sizeHeader) {
    const declaredSize = Number.parseInt(sizeHeader, 10);
    if (!Number.isNaN(declaredSize) && declaredSize > maxBytes) {
      throw new Error(
        `El archivo supera el limite de ${Math.floor(maxBytes / 1024 / 1024)}MB.`,
      );
    }
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > maxBytes) {
    throw new Error(
      `El archivo supera el limite de ${Math.floor(maxBytes / 1024 / 1024)}MB.`,
    );
  }

  return buffer;
};

const readHtmlWithGuard = async (
  response: Response,
  maxBytes: number,
): Promise<string> => {
  const sizeHeader = response.headers.get('content-length');

  if (sizeHeader) {
    const declaredSize = Number.parseInt(sizeHeader, 10);
    if (!Number.isNaN(declaredSize) && declaredSize > maxBytes) {
      throw new Error(
        'La pagina del link es demasiado pesada para analizarla.',
      );
    }
  }

  const html = await response.text();
  if (Buffer.byteLength(html, 'utf8') > maxBytes) {
    throw new Error('La pagina del link es demasiado pesada para analizarla.');
  }

  return html;
};

const normalizeUrl = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

const extractFirstLink = (content: string): string | null => {
  const match = content.match(LINK_PATTERN);

  if (!match?.[0]) {
    return null;
  }

  return normalizeUrl(match[0]);
};

const getHostname = (value: string): string => {
  try {
    return new URL(value).hostname;
  } catch {
    return 'unknown-host';
  }
};

const extractMetaContent = (html: string, key: string): string | null => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const direct = new RegExp(
    `<meta[^>]*(?:property|name)=["']${escapedKey}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'i',
  );
  const reverse = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escapedKey}["'][^>]*>`,
    'i',
  );

  const directMatch = html.match(direct)?.[1];
  if (directMatch) return directMatch;

  const reverseMatch = html.match(reverse)?.[1];
  if (reverseMatch) return reverseMatch;

  return null;
};

const extractMediaUrlFromHtml = (
  html: string,
  baseUrl: string,
): string | null => {
  const candidates = [
    'og:video:url',
    'og:video:secure_url',
    'og:video',
    'og:image:url',
    'og:image:secure_url',
    'og:image',
  ];

  for (const candidate of candidates) {
    const value = extractMetaContent(html, candidate);
    if (!value) continue;

    try {
      const resolved = new URL(value, baseUrl).toString();
      const normalized = normalizeUrl(resolved);
      if (normalized) {
        return normalized;
      }
    } catch {}
  }

  return null;
};

const resolveFromUrl = async (
  value: string,
  context: ResolveUrlContext = { depth: 0, visited: new Set<string>() },
): Promise<ResolvedMedia> => {
  const url = normalizeUrl(value);

  if (!url) {
    throw new Error('El link no es valido.');
  }

  const hostname = getHostname(url);

  if (context.depth > MAX_URL_RESOLVE_DEPTH) {
    logger.warn({ hostname, depth: context.depth }, 'Media URL depth overflow');
    throw new Error('No pude resolver un link directo desde esa pagina.');
  }

  if (context.visited.has(url)) {
    logger.warn({ hostname, depth: context.depth }, 'Media URL loop detected');
    throw new Error('Ese link entra en una redireccion circular.');
  }

  context.visited.add(url);
  logger.info(
    { hostname, depth: context.depth },
    'Resolviendo media desde URL',
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn(
        { hostname, status: response.status },
        'Fallo descarga de media URL',
      );
      throw new Error('No pude descargar ese link.');
    }

    const contentType =
      response.headers.get('content-type')?.toLowerCase() ?? '';
    const pathname = new URL(response.url).pathname;
    const ext = getExtension(pathname);
    const kind = parseMediaKind(contentType, ext);

    if (!kind) {
      if (contentType.includes('text/html')) {
        const html = await readHtmlWithGuard(response, MAX_HTML_BYTES);
        const extractedMediaUrl = extractMediaUrlFromHtml(html, response.url);

        if (!extractedMediaUrl) {
          logger.warn({ hostname }, 'No se encontro media OG en HTML');
          throw new Error(
            'Ese link no apunta a una imagen, gif o video compatible.',
          );
        }

        logger.info(
          {
            hostname,
            extractedHost: getHostname(extractedMediaUrl),
            depth: context.depth,
          },
          'Media extraida desde metadata HTML',
        );

        return resolveFromUrl(extractedMediaUrl, {
          depth: context.depth + 1,
          visited: context.visited,
        });
      }

      logger.warn({ hostname, contentType }, 'Tipo de media incompatible');
      throw new Error(
        'Ese link no apunta a una imagen, gif o video compatible.',
      );
    }

    const buffer = await readBufferWithGuard(response, MAX_MEDIA_BYTES);
    const extension =
      ext || (kind === 'video' ? 'mp4' : kind === 'gif' ? 'gif' : 'png');

    logger.info(
      {
        hostname,
        kind,
        size: buffer.length,
      },
      'Media URL resuelta',
    );

    return {
      buffer,
      kind,
      filename: sanitizeFilename(`input.${extension}`),
      extension,
      size: buffer.length,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      logger.warn({ hostname }, 'Timeout al descargar media URL');
      throw new Error('La descarga tardo demasiado. Proba con otro archivo.');
    }

    logger.warn(
      {
        hostname,
        error: error instanceof Error ? error.message : String(error),
      },
      'Error al resolver media URL',
    );

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const resolveFromAttachment = async (
  attachment: Attachment,
): Promise<ResolvedMedia> => {
  const extension = getExtension(attachment.name);
  const kind = parseMediaKind(attachment.contentType, extension);

  if (!kind) {
    throw new Error('Adjunta una imagen, gif o video compatible.');
  }

  if (attachment.size > MAX_MEDIA_BYTES) {
    throw new Error(
      `El archivo supera el limite de ${Math.floor(MAX_MEDIA_BYTES / 1024 / 1024)}MB.`,
    );
  }

  const media = await resolveFromUrl(attachment.url);
  logger.info(
    {
      hostname: getHostname(attachment.url),
      kind: media.kind,
      size: media.size,
    },
    'Media resuelta desde attachment',
  );

  return {
    ...media,
    filename: sanitizeFilename(attachment.name),
    extension: extension || media.extension,
  };
};

const firstEmbedMediaUrl = (message: Message): string | null => {
  for (const embed of message.embeds) {
    if (embed.image?.url) return embed.image.url;
    if (embed.video?.url) return embed.video.url;
    if (embed.thumbnail?.url) return embed.thumbnail.url;
  }

  return null;
};

const resolveFromMessage = async (
  message: Message,
): Promise<ResolvedMedia | null> => {
  const attachment = message.attachments.first();
  if (attachment) return resolveFromAttachment(attachment);

  const embedUrl = firstEmbedMediaUrl(message);
  if (embedUrl) return resolveFromUrl(embedUrl);

  const link = extractFirstLink(message.content);
  if (link) return resolveFromUrl(link);

  return null;
};

export const resolveMedia = async ({
  attachment,
  link,
  message,
}: ResolveMediaOptions): Promise<ResolvedMedia> => {
  if (attachment) {
    return resolveFromAttachment(attachment);
  }

  if (link) {
    return resolveFromUrl(link);
  }

  if (message?.reference?.messageId) {
    const repliedMessage = await message.fetchReference().catch(() => null);
    if (repliedMessage) {
      const fromReply = await resolveFromMessage(repliedMessage);
      if (fromReply) return fromReply;
    }
  }

  if (message) {
    const fromCurrentMessage = await resolveFromMessage(message);
    if (fromCurrentMessage) return fromCurrentMessage;
  }

  throw new Error(
    'No encontre media para procesar. Adjunta archivo, envia un link o responde un mensaje con media.',
  );
};
