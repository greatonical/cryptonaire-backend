import { Injectable, NestMiddleware } from '@nestjs/common';
import crypto from 'node:crypto';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const header = req.headers['x-request-id'];
    const id = Array.isArray(header) ? header[0] : header;
    const rid = id || crypto.randomUUID();
    req.id = rid;
    res.setHeader('X-Request-Id', rid);
    next();
  }
}