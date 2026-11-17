export const MIN_PASSWORD_LENGTH = 8;

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', 'qwerty123', 'qwertyuiop',
  'password1', 'password12', 'password1234', 'password1!', 'letmein123', 'welcome123',
  'password', 'password123', 'password123456', '123456789012345',
  'qwertyuiopasdfgh', 'qwerty123456789', 'adminadminadmin',
  'iloveyou12345678', 'пароль123456789', 'физлаб123456789',
]);

export function passwordFeedback(password, identity = {}) {
  if (password.length < MIN_PASSWORD_LENGTH) return 'Пароль должен содержать не менее 8 символов.';
  if (password.length > 128) return 'Пароль должен содержать не более 128 символов.';
  const lower = password.normalize('NFC').toLocaleLowerCase();
  if (COMMON.has(lower) || /^(.)\1{7,}$/u.test(lower) || /^(.{1,16})\1+$/u.test(lower)) {
    return 'Этот пароль слишком легко угадать. Придумайте длинную необычную фразу.';
  }
  for (const value of [identity.email?.split('@')[0], identity.firstName, identity.lastName]) {
    const part = String(value || '').normalize('NFC').toLocaleLowerCase();
    if (part.length >= 4 && lower.includes(part)) return 'Не используйте в пароле имя, фамилию или email.';
  }
  return null;
}

export function passwordStrength(password, identity = {}) {
  if (!password) return { label: 'Введите пароль', score: 0 };
  if (passwordFeedback(password, identity)) return { label: 'Слабый', score: 1 };
  const variety = [/[a-zа-яё]/u, /[A-ZА-ЯЁ]/u, /\d/u, /[^\p{L}\p{N}\s]/u].filter(pattern => pattern.test(password)).length;
  const score = password.length >= 24 || (password.length >= 18 && variety >= 3) ? 4 : password.length >= 12 ? 3 : 2;
  return { label: score === 4 ? 'Надёжный' : score === 3 ? 'Хороший' : 'Допустимый', score };
}
