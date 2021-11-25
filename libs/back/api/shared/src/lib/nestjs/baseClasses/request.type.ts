import { User } from '@prisma/client';
import { Request } from 'express';

export type RequestExtended = Request & { userId?: string; user?: User };
