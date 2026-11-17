import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.SMOKE_URL || 'http://127.0.0.1:4174';
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  for (const route of ['/', '/section/mechanics', '/topic/kinematics', '/topic/isoprocesses', '/topic/lorentz-force', '/topic/lenses', '/topic/photoelectric-effect', '/topic/radioactivity', '/login', '/register', '/recover', '/privacy']) {
    await page.goto(base + route);
    await page.waitForLoadState('networkidle');
    assert.ok((await page.title()).includes('ФизЛаб'), `Missing title: ${route}`);
    if (route.startsWith('/topic/')) {
      await page.getByRole('tab').first().click();
      await page.locator('canvas').first().waitFor({ state: 'visible' });
    }
    console.log('OK', route);
  }

  const email = `smoke-${Date.now()}@example.com`;
  const password = 'Unusual river stones at sunrise 42';
  const nextPassword = 'Quiet planets circle the blue moon';
  await page.goto(base + '/register');
  await page.getByPlaceholder('Имя', { exact: true }).fill('Проверка');
  await page.getByPlaceholder('Фамилия').fill('Физика');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Новый пароль (от 8 символов)').fill(password);
  await page.getByPlaceholder('Повторите пароль').fill(password);
  const passwordField = page.getByPlaceholder('Новый пароль (от 8 символов)');
  const confirmationField = page.getByPlaceholder('Повторите пароль');
  assert.equal(await passwordField.getAttribute('type'), 'password');
  await page.getByRole('button', { name: 'Показать пароль' }).click();
  assert.equal(await passwordField.getAttribute('type'), 'text');
  assert.equal(await confirmationField.getAttribute('type'), 'password');
  await page.getByRole('button', { name: 'Показать подтверждение пароля' }).click();
  assert.equal(await confirmationField.getAttribute('type'), 'text');
  await page.getByRole('button', { name: 'Скрыть пароль' }).click();
  await page.getByRole('button', { name: 'Скрыть подтверждение пароля' }).click();
  assert.equal(await passwordField.inputValue(), password);
  await page.getByText('Надёжный').waitFor();
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  const recoveryCode = await page.locator('code').innerText();
  assert.match(recoveryCode, /^[A-F0-9]{4}(?:-[A-F0-9]{4}){7}$/);
  await page.getByRole('button', { name: 'Я сохранил код' }).click();
  await page.waitForURL(base + '/');
  await page.getByRole('link', { name: 'Личный кабинет' }).waitFor();
  await page.goto(base + '/topic/kinematics');
  await page.getByRole('button', { name: 'Отметить тему изученной' }).click();
  await page.goto(base + '/account');
  await page.getByRole('progressbar', { name: 'Изученные темы' }).waitFor();
  assert.equal(await page.getByRole('progressbar', { name: 'Изученные темы' }).getAttribute('aria-valuenow'), '1');
  await page.getByRole('button', { name: 'Изучено (1)' }).click();
  await page.getByRole('link', { name: /Кинематика материальной точки/ }).waitFor();
  const avatarData = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d');
    context.fillStyle = '#7c6cf5'; context.fillRect(0, 0, 64, 64);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await page.getByLabel('Выбрать фото профиля').setInputFiles({ name: 'avatar.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(avatarData, 'base64') });
  await page.getByAltText('Фото профиля').waitFor();
  await page.reload();
  await page.getByAltText('Фото профиля').waitFor();
  assert.equal(await page.getByRole('progressbar', { name: 'Изученные темы' }).getAttribute('aria-valuenow'), '1');
  if (process.env.SMOKE_SHOTS === '1') {
    await page.screenshot({ path: 'data.local/account-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'data.local/account-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.getByRole('button', { name: 'Выйти' }).click();

  await page.goto(base + '/recover');
  await page.getByRole('button', { name: 'Использовать резервный код', exact: true }).click();
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Резервный код').fill(recoveryCode);
  await page.getByPlaceholder('Новый пароль (от 8 символов)').fill(nextPassword);
  await page.getByPlaceholder('Повторите пароль').fill(nextPassword);
  await page.getByRole('button', { name: 'Сменить пароль' }).click();
  const newCode = await page.locator('code').innerText();
  assert.notEqual(newCode, recoveryCode);
  await page.getByRole('button', { name: 'Я сохранил код' }).click();
  await page.waitForURL(base + '/');

  await page.goto(base + '/account');
  await page.getByText(email, { exact: true }).waitFor();
  await page.getByAltText('Фото профиля').waitFor();
  assert.equal(await page.getByRole('progressbar', { name: 'Изученные темы' }).getAttribute('aria-valuenow'), '1');
  await page.getByPlaceholder('Текущий пароль').fill(nextPassword);
  await page.getByRole('button', { name: 'Создать новый резервный код' }).click();
  const regeneratedCode = await page.locator('code').innerText();
  assert.notEqual(regeneratedCode, newCode);
  await page.getByRole('button', { name: 'Я сохранил код' }).click();
  await page.getByPlaceholder('Введите пароль для подтверждения').fill(nextPassword);
  await page.getByRole('button', { name: 'Удалить аккаунт и данные' }).click();
  await page.waitForURL(base + '/');
  console.log('OK signup, one-time recovery and account deletion');
  assert.deepEqual(errors, [], `Browser errors: ${errors.join(', ')}`);
} finally { await browser.close(); }
