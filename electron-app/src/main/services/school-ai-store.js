'use strict';
const fs = require('fs');
const path = require('path');
const { aiError } = require('./school-ai-transport');
const MAX_DAILY_TOKENS = 1000000;
const day = now => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(now));
class SchoolAiStore {
  constructor(directory, protection, now = Date.now) {
    this.file = path.join(directory, 'school-ai-private.json');
    this.protection = protection; this.now = now;
    this.state = { version: 1, key: '', dailyLimit: MAX_DAILY_TOKENS, day: day(now()), used: 0, actual: 0, calls: 0 };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.version !== 1 || typeof saved.key !== 'string' || saved.key.length > 8192 ||
          !Number.isInteger(saved.dailyLimit) || saved.dailyLimit < 10000 || saved.dailyLimit > 1000000 ||
          !['used', 'actual', 'calls'].every(k => Number.isSafeInteger(saved[k]) && saved[k] >= 0)) throw Error();
      // Upgrade existing limits without resetting the key or today's accounting.
      this.state = { ...saved, dailyLimit: MAX_DAILY_TOKENS };
    } catch (error) {
      if (error.code !== 'ENOENT') this.loadError = true;
    }
  }
  available() {
    return this.protection.isEncryptionAvailable() && this.protection.getSelectedStorageBackend?.() !== 'basic_text';
  }
  rollover() {
    const today = day(this.now());
    if (this.state.day !== today) Object.assign(this.state, { day: today, used: 0, actual: 0, calls: 0 });
  }
  write() {
    const temp = this.file + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 }); fs.renameSync(temp, this.file); }
    catch (_) { throw aiError('STORAGE', 'AI 설정을 저장하지 못했습니다. 저장 공간과 파일 권한을 확인해 주세요.'); }
  }
  status() {
    this.rollover();
    return { configured: !!this.state.key && !this.loadError, encryptionAvailable: this.available(),
      dailyLimit: this.state.dailyLimit, used: this.state.used, actual: this.state.actual, calls: this.state.calls,
      day: this.state.day, storageError: !!this.loadError };
  }
  save({ apiKey } = {}) {
    if (typeof apiKey !== 'string' || apiKey.length > 300 || /\s/.test(apiKey.trim())) throw aiError('KEY', 'API 키 형식을 확인해 주세요.');
    if (!apiKey.trim() && !this.state.key) throw aiError('KEY_REQUIRED', '처음 사용할 때는 개인 Gemini API 키를 입력해 주세요.');
    if (!this.available()) throw aiError('ENCRYPTION', '이 PC에서 안전한 키 저장소를 사용할 수 없습니다.');
    const previous = { ...this.state };
    this.state.dailyLimit = MAX_DAILY_TOKENS;
    if (apiKey.trim()) this.state.key = this.protection.encryptString(apiKey.trim()).toString('base64');
    try { this.write(); this.loadError = false; } catch (e) { this.state = previous; throw e; }
    return this.status();
  }
  removeKey() {
    const previous = this.state.key; this.state.key = '';
    try { this.write(); this.loadError = false; } catch (e) { this.state.key = previous; throw e; }
  }
  key() {
    if (this.loadError) throw aiError('STORAGE', 'AI 설정 파일을 읽지 못했습니다. 키를 다시 등록해 주세요.');
    if (!this.state.key) throw aiError('KEY_REQUIRED', '환경설정 → API Key 관리에서 개인 Gemini API 키를 먼저 등록해 주세요.');
    if (!this.available()) throw aiError('ENCRYPTION', '이 PC의 암호화 저장소를 사용할 수 없습니다.');
    try { return this.protection.decryptString(Buffer.from(this.state.key, 'base64')); }
    catch (_) { throw aiError('KEY', '이 PC에서 키를 복호화할 수 없습니다. 개인 키를 다시 등록해 주세요.'); }
  }
  reserve(amount) {
    if (this.loadError) throw aiError('STORAGE', 'AI 설정 파일을 읽지 못했습니다. 키를 다시 등록해 주세요.');
    this.rollover();
    if (this.state.used + amount > this.state.dailyLimit) throw aiError('DAILY_LIMIT', '오늘의 AI 이용 한도에 도달했습니다. 내일 다시 이용해 주세요.');
    this.state.used += amount; this.state.calls++;
    try { this.write(); } catch (e) { this.state.used -= amount; this.state.calls--; throw e; }
    return { amount, day: this.state.day };
  }
  settle(receipt, actual) {
    this.rollover();
    if (receipt.day !== this.state.day || !Number.isSafeInteger(actual) || actual < 0) return;
    this.state.used = Math.max(0, this.state.used - receipt.amount + actual);
    this.state.actual += actual; this.write();
  }
}
module.exports = { SchoolAiStore, day, MAX_DAILY_TOKENS };
