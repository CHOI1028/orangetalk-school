/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
const https = require('https');

function calendarRequest(method, apiPath, accessToken, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.googleapis.com',
      path: apiPath,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        // DELETE returns 204 with no body
        if (res.statusCode === 204) return resolve({});
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.error ? parsed.error.message : 'Calendar API Error ' + res.statusCode));
        } catch (e) {
          reject(new Error('JSON parse error'));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function listCalendars(accessToken) {
  const result = await calendarRequest(
    'GET',
    '/calendar/v3/users/me/calendarList',
    accessToken
  );
  return result.items || [];
}

async function listEvents(accessToken, calendarId, options) {
  const params = new URLSearchParams();
  if (options) {
    if (options.timeMin) params.set('timeMin', options.timeMin);
    if (options.timeMax) params.set('timeMax', options.timeMax);
    if (options.maxResults) params.set('maxResults', String(options.maxResults));
    if (options.q) params.set('q', options.q);
  }
  params.set('singleEvents', 'true');
  params.set('orderBy', 'startTime');

  const qs = params.toString();
  const apiPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) +
    '/events' + (qs ? '?' + qs : '');

  const result = await calendarRequest('GET', apiPath, accessToken);
  return result.items || [];
}

async function createEvent(accessToken, calendarId, eventBody) {
  const apiPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events';
  return await calendarRequest('POST', apiPath, accessToken, eventBody);
}

async function updateEvent(accessToken, calendarId, eventId, eventBody) {
  const apiPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) +
    '/events/' + encodeURIComponent(eventId);
  return await calendarRequest('PATCH', apiPath, accessToken, eventBody);
}

async function deleteEvent(accessToken, calendarId, eventId) {
  const apiPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) +
    '/events/' + encodeURIComponent(eventId);
  return await calendarRequest('DELETE', apiPath, accessToken);
}

/* ── 공유(ACL) — 누구와 공유되는지 조회 / 공유 대상·권한 추가·수정·삭제 (2026-07-02) ── */
async function listAcl(accessToken, calendarId) {
  const apiPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/acl';
  return await calendarRequest('GET', apiPath, accessToken);
}
async function insertAcl(accessToken, calendarId, rule) {
  const apiPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/acl';
  return await calendarRequest('POST', apiPath, accessToken, rule);
}
async function updateAcl(accessToken, calendarId, ruleId, rule) {
  const apiPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/acl/' + encodeURIComponent(ruleId);
  return await calendarRequest('PUT', apiPath, accessToken, rule);
}
async function deleteAcl(accessToken, calendarId, ruleId) {
  const apiPath = '/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/acl/' + encodeURIComponent(ruleId);
  return await calendarRequest('DELETE', apiPath, accessToken);
}

/* 새 캘린더 생성 (2026-07-02) */
async function createCalendar(accessToken, summary) {
  return await calendarRequest('POST', '/calendar/v3/calendars', accessToken, { summary: summary });
}

module.exports = { listCalendars, listEvents, createEvent, updateEvent, deleteEvent, listAcl, insertAcl, updateAcl, deleteAcl, createCalendar };
