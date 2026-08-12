import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return 'scrypt$' + salt.toString('base64') + '$' + hash.toString('base64');
}
function verifyPassword(pw, stored) {
  try {
    const [algo, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(pw, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}
for (const [u,p] of [['admin','admin123'],['guru','guru123']]) {
  const h = hashPassword(p);
  console.log(u, '=>', h, '| verify:', verifyPassword(p,h), '| wrong:', verifyPassword('x',h));
}
