import { loadEnvConfig } from '@next/env';
import { prisma } from '../lib/prisma';

async function clearE2eAuthRateLimits() {
  loadEnvConfig(process.cwd());
  await prisma.authRateLimit.deleteMany();
  await prisma.$disconnect();
}

export default clearE2eAuthRateLimits;
