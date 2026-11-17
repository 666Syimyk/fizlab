import { spawnSync } from 'node:child_process';

// Configuration audit only; no creation/deployment, purchases, email or secret output.
const failures = [];
const mobile = spawnSync(process.execPath, ['scripts/check-mobile-api.mjs'], { env: process.env, encoding: 'utf8' });
if (mobile.status !== 0) failures.push('VITE_API_URL: нужен постоянный HTTPS API с путём /api.');
if (!/^goog_[A-Za-z0-9]+$/.test(process.env.VITE_REVENUECAT_GOOGLE_API_KEY || '')) failures.push('VITE_REVENUECAT_GOOGLE_API_KEY: нужен публичный Android SDK key RevenueCat.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.VITE_SUPPORT_EMAIL || '') || /@(example\.(com|org|net)|.*\.(example|test|invalid))$/i.test(process.env.VITE_SUPPORT_EMAIL || '')) failures.push('VITE_SUPPORT_EMAIL: нужен настоящий публичный контакт поддержки.');
if (!process.env.VITE_DEVELOPER_NAME?.trim()) failures.push('VITE_DEVELOPER_NAME: укажите имя или организацию владельца приложения.');
if (mobile.status === 0) {
  try {
    const response = await fetch(`${process.env.VITE_API_URL.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    const health = await response.json();
    if (!response.ok || health.ok !== true) failures.push('Backend не прошёл проверку доступности.');
    if (health.billing !== true) failures.push('На backend не настроен секретный ключ RevenueCat.');
    if (health.email !== true) failures.push('На backend не настроена отправка писем.');
    if (health.sandboxBilling !== false) failures.push('Для production отключите sandbox-подписки на backend.');
    for (const route of ['/privacy', '/terms', '/account/delete']) {
      const page = await fetch(new URL(route, process.env.VITE_API_URL), { signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) failures.push(`Публичная страница ${route} недоступна.`);
      await page.body?.cancel();
    }
  } catch { failures.push('Не удалось проверить backend и публичные страницы по HTTPS.'); }
}
if (failures.length) {
  console.error('Выпуск пока не готов:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Публичная конфигурация и доступность сервисов проверены. До публикации нужны подписанный AAB, реальные тесты Play/почты, Data safety и проверка магазина.');
}
