import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export function safeEqualSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isLocalDirectRequest(req: IncomingMessage): boolean {
  const remoteAddr = req.socket.remoteAddress ?? '';
  const isLocalhost = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
  if (!isLocalhost) return false;

  const host = req.headers.host ?? '';
  const hasLocalHost = host.startsWith('localhost:') || host.startsWith('127.0.0.1:') || host.startsWith('[::1]:');
  return hasLocalHost;
}

export interface AuthConfig {
  token?: string;
  password?: string;
}

export function createAuthChecker(config: AuthConfig): (req: IncomingMessage) => boolean {
  const expectedToken = config.token;
  const expectedPassword = config.password;

  return (req: IncomingMessage): boolean => {
    if (!expectedToken && !expectedPassword) return true;
    if (isLocalDirectRequest(req)) return true;

    const authHeader = req.headers.authorization ?? '';
    if (expectedToken && authHeader.startsWith('Bearer ')) {
      const provided = authHeader.slice(7);
      return safeEqualSecret(provided, expectedToken);
    }

    if (expectedPassword && authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx >= 0) {
        const password = decoded.slice(colonIdx + 1);
        return safeEqualSecret(password, expectedPassword);
      }
    }

    return false;
  };
}
