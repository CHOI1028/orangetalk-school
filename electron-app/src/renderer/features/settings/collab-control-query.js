/* Read-only collaboration queries. Never fall back to an untrusted local port. */
const messages = {
  'server-stopped': '웹 서버가 꺼져 있습니다. 협업하려면 웹 서버를 켜 주세요.',
  'server-starting': '웹 서버의 접속 준비가 아직 끝나지 않았습니다. 잠시 후 다시 불러와 주세요.',
  'host-auth-unavailable': '메인 PC의 내부 인증 정보가 준비되지 않았습니다. 프로그램을 완전히 종료한 뒤 다시 실행해 주세요.',
  'host-auth-failed': '웹 서버가 메인 PC의 내부 인증을 거부했습니다. 프로그램을 완전히 종료한 뒤 다시 실행해 주세요.',
  'runtime-restart': '조회 기능을 적용하려면 프로그램을 완전히 종료한 뒤 다시 실행해 주세요.',
  'host-only': '이 조회는 메인 PC의 오렌지톡에서만 사용할 수 있습니다.',
  'server-changed': '조회 중 웹 서버 상태가 변경되었습니다. 다시 불러와 주세요.',
  'timeout': '웹 서버 응답 대기 시간이 초과되었습니다. 잠시 후 다시 불러와 주세요.',
  'connection-refused': '웹 서버의 실행 포트에 연결하지 못했습니다. 실행 상태를 확인한 뒤 다시 불러와 주세요.',
  'connection-failed': '웹 서버에 연결하지 못했습니다. 실행 상태를 확인한 뒤 다시 불러와 주세요.',
  'http-error': '웹 서버가 정상 응답을 보내지 않았습니다. 잠시 후 다시 불러와 주세요.',
  'invalid-response': '웹 서버의 응답 형식을 확인하지 못했습니다. 다시 불러와 주세요.',
  'invite-key-missing': '접속용 키를 확인하지 못해 복사를 막았습니다. 프로그램을 완전히 종료한 뒤 다시 실행해 주세요.',
  'lan-address-missing': '동료 PC에 전달할 내부망 IP 주소를 찾지 못했습니다. 네트워크 연결 상태를 확인해 주세요.',
  'ipc-failed': '프로그램 내부 조회에 실패했습니다. 다시 불러오거나 프로그램을 다시 실행해 주세요.'
};
export function collabControlMessage(code) { return messages[code] || messages['connection-failed']; }
export async function readCollabControl(kind, options = {}) {
  const api = options.api;
  const isWeb = !!options.isWeb;
  const timeoutMs = options.timeoutMs || (kind === 'scan' ? 22000 : 8500);
  const controller = new AbortController();
  let timer;
  const work = async () => {
    if (isWeb) {
      if (kind !== 'info') return { success: false, code: 'host-only' };
      try {
        const response = await (options.fetchImpl || globalThis.fetch)('/api/server-info', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return { success: false, code: response.status === 401 || response.status === 403 ? 'host-auth-failed' : 'http-error' };
        const data = await response.json();
        return data && data.success === true ? data : { success: false, code: 'invalid-response' };
      } catch (_) { return { success: false, code: controller.signal.aborted ? 'timeout' : 'connection-failed' }; }
    }
    const name = { info: 'webServerConnectionInfo', scan: 'webServerPortScan', status: 'webServerStatus' }[kind];
    if (!name || !api || typeof api[name] !== 'function') return { success: false, code: 'runtime-restart' };
    try {
      for (let attempt = 0; attempt < 7 && !controller.signal.aborted; attempt++) {
        const result = await api[name]();
        if (controller.signal.aborted) return { success: false, code: 'timeout' };
        if (result && result.success === false && result.code === 'server-starting' && attempt < 6) {
          await new Promise(resolve => setTimeout(resolve, 350)); continue;
        }
        if (!result || typeof result.success !== 'boolean') return { success: false, code: 'invalid-response' };
        if (!result.success) return { success: false, code: Object.hasOwn(messages, result.code) ? result.code : 'connection-failed' };
        return result;
      }
      return { success: false, code: 'timeout' };
    } catch (_) { return { success: false, code: 'ipc-failed' }; }
  };
  try {
    return await Promise.race([work(), new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve({ success: false, code: 'timeout' }); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
