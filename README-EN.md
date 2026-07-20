# <img src="assets/logo_big.png" alt="OrangeTalk" width="72" valign="middle"> OrangeTalk

**An integrated school-health-office desktop app, built by a school health teacher, for school health teachers.**

> This is the official release repository. Only the installer, notices and copyright statements are published here — **no source code** is included.

---

## Download

Grab the latest installer here:

👉 **[Download the latest release](https://github.com/jwkim2353/my-health-diary/releases/latest)**

- OS : Windows 10 / 11 (x64)
- File : `OrangeTalk.Setup.x.x.x.exe`
- Official channel : GitHub Releases (this repo)

---

## Installation

1. Download `OrangeTalk.Setup.x.x.x.exe` from the Releases page above.
2. Double-click the file to launch the installer.
3. Windows SmartScreen or your AV may flag the installer (the binary is not code-signed yet). See the workaround below.

### SmartScreen bypass

1. On the SmartScreen dialog click **More info** → **Run anyway**.
2. Installation proceeds normally.

### AV quarantine (e.g. AhnLab V3)

On some school PCs an AV product silently quarantines the installed files, resulting in an "installed but empty" folder. If this happens:

- Whitelist `%LOCALAPPDATA%\Programs\OrangeTalk` in your AV settings.
- Or contact the author to submit a false-positive report.

---

## Auto-update

Starting with v1.0, OrangeTalk includes a built-in auto-updater.

- On launch the app checks for a newer version and downloads it in the background.
- The update installs automatically the next time you close the app.
- You can also trigger a check or restart-and-install from **Settings → 🔄 업데이트 확인**.

---

## System requirements

| Item | Recommended |
|---|---|
| OS | Windows 10 (1809) or later · Windows 11 |
| Architecture | x64 |
| RAM | 4 GB or more |
| Disk | 500 MB for install + room for your records |
| Network | Optional — required only for Google Drive backup and external APIs |

---

## Key features

- **Daily health log** — symptoms, treatments, medications for every visit
- **First-aid and infectious-disease records** — dedicated, separate logs
- **People management** — bulk Excel upload; special-care / underlying-condition / consent tracking
- **Dashboard & statistics** — day / week / month / semester / year views, heatmaps, repeat-visit analysis
- **Kiosk mode** — self check-in for students on a tablet
- **Custom forms** — visit passes, meal-request slips, referrals, fully user-configurable
- **Public API integrations** — Korean drug DB, Air Korea, KMA weather, NEMC emergency, HIRA, Kakao Maps
- **Body map & symptom → treatment** — anatomical pain picker with recommendations
- **Two-teacher collaboration** — shared DB for schools with two health teachers
- **Lending ledger** — tracks borrowed items with return reminders
- **PDF export** — range / column selection

---

## Copyright & license

This is **proprietary (closed-source) software**.

- Copyright (c) 2026 김재웅 (Jaewoong Kim). All rights reserved.
- Free for **non-commercial internal health-office use** at your institution.
- Redistribution, reverse engineering, source extraction and commercial use are **prohibited**.
- For any commercial use (enterprise deployment, paid services, advertising partnerships, etc.), you must contact the author in advance and execute a separate commercial license.

See [LICENSE](LICENSE) (English summary) and [LICENSE-KO](LICENSE-KO) (Korean, controlling) for the full terms. Third-party open-source components and their licenses are listed in [NOTICE](NOTICE).

---

## Contact

| Purpose | Address |
|---|---|
| General inquiries, bug reports, feature requests | jwkim2353@gmail.com |
| Commercial licensing, enterprise deployment | jwkim2353@gmail.com |
| Advertising, sponsorship, partnerships | jwkim2353@gmail.com |

## Author

**Jaewoong Kim** — school health teacher at Gukbang-Hanggong High School

**Technical advisor** : Dr. Ki-young Lee — ETRI (Electronics and Telecommunications Research Institute), PhD
