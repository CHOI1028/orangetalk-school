/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
'use strict';

/**
 * google-integration-service.js — Google API 통합 서비스
 *
 * DriveSyncService — Drive JSON 동기화
 * GoogleWorkspaceExportService — Sheets 내보내기
 * PlannerCalendarService — Calendar 연동
 */

/* ══════════ DriveSyncService ══════════ */

/**
 * DriveSyncService — Google Drive JSON 파일 동기화
 * 검색 → 조건부 upsert 로직을 캡슐화합니다.
 * 생성자에서 Drive API 함수를 주입받습니다.
 */
class DriveSyncService {
  /**
   * @param {object} deps
   * @param {Function} deps.getSheetsToken
   * @param {Function} deps.driveSearchFile
   * @param {Function} deps.driveUploadJson
   * @param {Function} deps.driveUpdateJson
   * @param {Function} deps.driveDownloadFile
   */
  constructor(deps) {
    this._deps = deps;
  }

  /**
   * Drive에 JSON 파일을 upsert합니다.
   * 동일한 이름의 파일이 folderId 내에 존재하면 업데이트, 없으면 신규 업로드.
   * @returns {{ fileId: string, updated: boolean }}
   */
  async upload(fileName, jsonContent, folderId) {
    const { getSheetsToken, driveSearchFile, driveUploadJson, driveUpdateJson } = this._deps;
    const token = await getSheetsToken();
    const search = await driveSearchFile(token, fileName, folderId);
    if (search.files && search.files.length > 0) {
      const result = await driveUpdateJson(token, search.files[0].id, jsonContent);
      return { fileId: result.id, updated: true };
    } else {
      const result = await driveUploadJson(token, fileName, jsonContent, folderId);
      return { fileId: result.id, updated: false };
    }
  }

  /**
   * Drive에서 JSON 파일을 검색 후 다운로드합니다.
   * @returns {{ data: object|null, exists: boolean, fileId?: string, modifiedTime?: string }}
   */
  async download(fileName, folderId) {
    const { getSheetsToken, driveSearchFile, driveDownloadFile } = this._deps;
    const token = await getSheetsToken();
    const search = await driveSearchFile(token, fileName, folderId);
    if (!search.files || search.files.length === 0) {
      return { data: null, exists: false };
    }
    const raw = await driveDownloadFile(token, search.files[0].id);
    return {
      data: JSON.parse(raw),
      exists: true,
      fileId: search.files[0].id,
      modifiedTime: search.files[0].modifiedTime
    };
  }
}

/* ══════════ GoogleWorkspaceExportService ══════════ */

/**
 * GoogleWorkspaceExportService — Google Sheets/Drive 내보내기 작업 오케스트레이터
 * 생성자에서 API 함수를 주입받아 사용합니다.
 */
class GoogleWorkspaceExportService {
  /**
   * @param {object} deps
   * @param {Function} deps.getSheetsToken
   * @param {Function} deps.createSpreadsheet
   * @param {Function} deps.writeSheet
   * @param {Function} deps.batchUpdateSpreadsheet
   * @param {Function} deps.driveMoveFile
   */
  constructor(deps) {
    this._deps = deps;
  }

  async runExportJob(job) {
    const { getSheetsToken, createSpreadsheet, writeSheet, batchUpdateSpreadsheet, driveMoveFile } = this._deps;

    const token = await getSheetsToken();
    const authClient = { accessToken: token };
    const createRes = await createSpreadsheet(authClient, job.title, job.sheetTitle);
    const spreadsheetId = createRes.spreadsheetId;
    const spreadsheetUrl = createRes.spreadsheetUrl || ('https://docs.google.com/spreadsheets/d/' + spreadsheetId);
    const sheetId = createRes.sheetId || 0;

    /* 렌더러는 sheetId:0을 가정 → 주어진 실제 sheetId 로 치환 */
    const rewriteSheetIdFn = (targetSheetId) => (obj) => {
      if (obj == null || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { obj.forEach(rewriteSheetIdFn(targetSheetId)); return; }
      for (const k of Object.keys(obj)) {
        if (k === 'sheetId' && (obj[k] === 0 || obj[k] === '0')) obj[k] = targetSheetId;
        else if (typeof obj[k] === 'object') rewriteSheetIdFn(targetSheetId)(obj[k]);
      }
    };

    await writeSheet(authClient, spreadsheetId, job.range, job.values || []);

    if (Array.isArray(job.requests) && job.requests.length > 0) {
      job.requests.forEach(rewriteSheetIdFn(sheetId));
      await batchUpdateSpreadsheet(authClient, spreadsheetId, job.requests);
    }

    /* 부가 시트 — 진료과별 통계 표지 등 별도 워크시트로 포함하고 싶을 때 사용
       각 아이템: { sheetTitle, range, values, requests } */
    if (Array.isArray(job.additionalSheets) && job.additionalSheets.length > 0) {
      for (const extra of job.additionalSheets) {
        if (!extra || !extra.sheetTitle) continue;
        /* addSheet 요청 — 응답에서 새 sheetId 획득 */
        const addRes = await batchUpdateSpreadsheet(authClient, spreadsheetId, [
          { addSheet: { properties: { title: extra.sheetTitle } } }
        ]);
        const newSheetId = addRes && addRes.replies && addRes.replies[0]
          && addRes.replies[0].addSheet && addRes.replies[0].addSheet.properties
          ? addRes.replies[0].addSheet.properties.sheetId : null;
        if (newSheetId == null) continue;
        /* 값 쓰기 (range 는 시트 이름이 포함된 A1 표기) */
        if (extra.range && Array.isArray(extra.values)) {
          await writeSheet(authClient, spreadsheetId, extra.range, extra.values);
        }
        /* 서식 적용 — sheetId:0 → newSheetId 재맵핑 */
        if (Array.isArray(extra.requests) && extra.requests.length > 0) {
          extra.requests.forEach(rewriteSheetIdFn(newSheetId));
          await batchUpdateSpreadsheet(authClient, spreadsheetId, extra.requests);
        }
      }
    }

    if (job.targetFolderId) {
      await driveMoveFile(authClient, spreadsheetId, job.targetFolderId);
    }

    return { spreadsheetId, spreadsheetUrl, sheetId, movedToFolder: !!job.targetFolderId };
  }
}

/* ══════════ PlannerCalendarService ══════════ */

class PlannerCalendarService {
  constructor(calendarDeps) {
    this.calendarDeps = calendarDeps;
  }

  async loadMonthBundle(date) {
    const { getValidAccessToken, listCalendars, listEvents } = this.calendarDeps;
    const token = await getValidAccessToken();
    const calendars = await listCalendars(token);
    const base = String(date);
    const dp = base.split('-');
    const yr = parseInt(dp[0], 10);
    const mo = parseInt(dp[1], 10) - 1;
    const timeMin = new Date(yr, mo, 1).toISOString();
    const timeMax = new Date(yr, mo + 1, 0, 23, 59, 59).toISOString();
    const results = await Promise.all((calendars || []).map(async (cal) => {
      try {
        const events = await listEvents(token, cal.id, { timeMin, timeMax });
        return (events || []).map((ev) => Object.assign({}, ev, {
          _calId: cal.id,
          _calColor: cal.backgroundColor || '#3b82f6',
          _calName: cal.summary || ''
        }));
      } catch (err) {
        return [];
      }
    }));

    const eventsByDate = {};
    let totalCount = 0;
    results.forEach((evList) => {
      (evList || []).forEach((ev) => {
        let ds = '';
        if (ev.start && ev.start.dateTime) ds = ev.start.dateTime.substring(0, 10);
        else if (ev.start && ev.start.date) ds = ev.start.date;
        if (ds) {
          if (!eventsByDate[ds]) eventsByDate[ds] = [];
          eventsByDate[ds].push(ev);
          totalCount += 1;
        }
      });
    });

    return {
      calendars,
      eventsByDate,
      totalCount,
      primaryCalendarId: ((calendars || []).find((c) => c.primary) || (calendars || [])[0] || {}).id || 'primary'
    };
  }

  async createAllDayTodo(calendarId, date, summary, colorId) {
    const { getValidAccessToken, createEvent } = this.calendarDeps;
    const token = await getValidAccessToken();
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    const endDate = nextDay.getFullYear() + '-' + String(nextDay.getMonth() + 1).padStart(2, '0') + '-' + String(nextDay.getDate()).padStart(2, '0');
    return createEvent(token, calendarId || 'primary', {
      summary,
      colorId,
      start: { date },
      end: { date: endDate }
    });
  }
}

module.exports = { DriveSyncService, GoogleWorkspaceExportService, PlannerCalendarService };
