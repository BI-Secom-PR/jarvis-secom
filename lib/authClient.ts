'use client';

import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

export async function logout(router: AppRouterInstance): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
  router.push('/login');
}
