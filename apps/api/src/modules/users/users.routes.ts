import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { sendSuccess } from '../../lib/response.js';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';

export const usersRouter = Router();

usersRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new NotFoundError('User not found');
    }
    sendSuccess(res, {
      ...user,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
