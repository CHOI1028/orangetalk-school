/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
const https = require('https');

function _sheetsRequestOnce(method, path, accessToken, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'sheets.googleapis.com',
      path: path,
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
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, data: parsed });
          else resolve({ ok: false, status: res.statusCode, data: parsed, message: parsed.error ? parsed.error.message : 'API Error ' + res.statusCode });
        } catch (e) {
          resolve({ ok: false, status: res.statusCode, message: 'JSON parse error' });
        }
      });
    });

    req.on('error', (err) => resolve({ ok: false, status: 0, message: String(err && err.message || err) }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function sheetsRequest(method, path, accessToken, body) {
  const delays = [0, 500, 1500, 3500];
  let last;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise(r => setTimeout(r, delays[i]));
    const res = await _sheetsRequestOnce(method, path, accessToken, body);
    if (res.ok) return res.data;
    last = res;
    const retryable = res.status === 0 || res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
    if (!retryable) break;
  }
  throw new Error(last && last.message || 'API Error');
}

async function readSheet(authClient, spreadsheetId, range) {
  const path = '/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) +
    '/values/' + encodeURIComponent(range);
  const result = await sheetsRequest('GET', path, authClient.accessToken);
  return result.values || [];
}

async function writeSheet(authClient, spreadsheetId, range, values) {
  const path = '/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) +
    '/values/' + encodeURIComponent(range) + '?valueInputOption=USER_ENTERED';
  await sheetsRequest('PUT', path, authClient.accessToken, {
    range: range,
    majorDimension: 'ROWS',
    values: values
  });
}

async function getSheetMetadata(authClient, spreadsheetId) {
  const path = '/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) +
    '?fields=properties.title,sheets.properties';
  return await sheetsRequest('GET', path, authClient.accessToken);
}

async function createSpreadsheet(authClient, title, sheetTitle) {
  const body = {
    properties: { title: title },
    sheets: [{ properties: { title: sheetTitle || 'Sheet1' } }]
  };
  const result = await sheetsRequest('POST', '/v4/spreadsheets', authClient.accessToken, body);
  return { spreadsheetId: result.spreadsheetId, spreadsheetUrl: result.spreadsheetUrl, sheetId: result.sheets[0].properties.sheetId };
}

async function batchUpdateSpreadsheet(authClient, spreadsheetId, requests) {
  const path = '/v4/spreadsheets/' + encodeURIComponent(spreadsheetId) + ':batchUpdate';
  return await sheetsRequest('POST', path, authClient.accessToken, { requests: requests });
}

/* ── Google Drive API ── */
function _driveRequestOnce(method, path, accessToken, body) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.googleapis.com',
      path: path,
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
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, data: parsed });
          else resolve({ ok: false, status: res.statusCode, data: parsed, message: parsed.error ? parsed.error.message : 'Drive API Error ' + res.statusCode });
        } catch (e) { resolve({ ok: false, status: res.statusCode, message: 'JSON parse error' }); }
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, message: String(err && err.message || err) }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function driveRequest(method, path, accessToken, body) {
  const delays = [0, 500, 1500, 3500];
  let last;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise(r => setTimeout(r, delays[i]));
    const res = await _driveRequestOnce(method, path, accessToken, body);
    if (res.ok) return res.data;
    last = res;
    const retryable = res.status === 0 || res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
    if (!retryable) break;
  }
  throw new Error(last && last.message || 'Drive API Error');
}

async function driveListFolders(accessToken, parentId) {
  const parent = parentId || 'root';
  const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false and '" + parent + "' in parents");
  const path = '/drive/v3/files?q=' + q + '&fields=files(id,name)&orderBy=name&pageSize=100';
  const result = await driveRequest('GET', path, accessToken);
  return result.files || [];
}

async function driveCreateFolder(accessToken, name, parentId) {
  const body = {
    name: name,
    mimeType: 'application/vnd.google-apps.folder'
  };
  if (parentId) body.parents = [parentId];
  return await driveRequest('POST', '/drive/v3/files', accessToken, body);
}

async function driveMoveFile(accessToken, fileId, newParentId) {
  const path = '/drive/v3/files/' + fileId + '?addParents=' + newParentId + '&removeParents=root&fields=id,parents';
  return await driveRequest('PATCH', path, accessToken, {});
}

/* ── Drive 파일 업로드 (multipart) ── */
function driveUploadJson(accessToken, fileName, jsonContent, parentId) {
  return new Promise((resolve, reject) => {
    const boundary = '---DriveUpload' + Date.now();
    const metadata = { name: fileName, mimeType: 'application/json' };
    if (parentId) metadata.parents = [parentId];
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' +
      (typeof jsonContent === 'string' ? jsonContent : JSON.stringify(jsonContent)) +
      '\r\n--' + boundary + '--';
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/upload/drive/v3/files?uploadType=multipart&fields=id,name',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'multipart/related; boundary=' + boundary,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.error ? parsed.error.message : 'Upload error ' + res.statusCode));
        } catch (e) { reject(new Error('Upload parse error')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function driveUpdateJson(accessToken, fileId, jsonContent) {
  return new Promise((resolve, reject) => {
    const body = typeof jsonContent === 'string' ? jsonContent : JSON.stringify(jsonContent);
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/upload/drive/v3/files/' + fileId + '?uploadType=media&fields=id,name,modifiedTime',
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.error ? parsed.error.message : 'Update error ' + res.statusCode));
        } catch (e) { reject(new Error('Update parse error')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function driveSearchFile(accessToken, fileName, parentId) {
  const parent = parentId || 'root';
  const q = encodeURIComponent("name='" + fileName.replace(/'/g, "\\'") + "' and mimeType='application/json' and trashed=false and '" + parent + "' in parents");
  const filePath = '/drive/v3/files?q=' + q + '&fields=files(id,name,modifiedTime)&pageSize=1';
  return driveRequest('GET', filePath, accessToken);
}

function driveDownloadFile(accessToken, fileId) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/drive/v3/files/' + fileId + '?alt=media',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + accessToken }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error('Download error ' + res.statusCode));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { readSheet, writeSheet, getSheetMetadata, createSpreadsheet, batchUpdateSpreadsheet, driveListFolders, driveCreateFolder, driveMoveFile, driveUploadJson, driveUpdateJson, driveSearchFile, driveDownloadFile };
