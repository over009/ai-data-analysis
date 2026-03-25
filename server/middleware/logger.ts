import { Request, Response, NextFunction } from 'express';

export function logger(req: Request, _res: Response, next: NextFunction) {
  const log = {
    timestamp: new Date().toISOString(),
    level: 'info',
    type: 'http_request',
    data: {
      method: req.method,
      path: req.path,
    }
  };
  console.log(JSON.stringify(log));
  next();
}
