import { hashPassword } from "../src/lib/crypto";

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error("Использование: npm run hash-password -- 'пароль-не-короче-10-символов'");
  process.exit(1);
}
console.log(`ADMIN_PASSWORD_HASH='${hashPassword(pw)}'`);
