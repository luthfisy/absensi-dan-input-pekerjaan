// ============================================================
//  KONFIGURASI
// ============================================================
const SPREADSHEET_ID = '1knBfdxwI-84J8TAI57r7ZHerrPl0gVyPOaInq-cX_B0';

function getSheet_(name) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
}

function fmt_(date, pattern) {
  return Utilities.formatDate(
    date instanceof Date ? date : new Date(date),
    Session.getScriptTimeZone(), pattern
  );
}

// SHA-256 hash untuk password
function hashPassword_(plain) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(plain), Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// Normalisasi role: "admin"/"ADMIN" → "Admin", dll.
function normalizeRole_(r) {
  const s = String(r || '').trim().toLowerCase();
  if (s === 'owner') return 'Owner';
  if (s === 'admin') return 'Admin';
  return 'User';
}

// ─── SERVE ──────────────────────────────────────────────────
function doGet(e) {
  const tmpl = HtmlService.createTemplateFromFile('Index');
  tmpl.isPublicPage = (e && e.parameter && e.parameter.page === 'statistik');
  return tmpl.evaluate()
    .setTitle('Absensi dan Input Kegiatan')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ─── AUTH ────────────────────────────────────────────────────
function login(username, password) {
  const sheet  = getSheet_('Users');
  const data   = sheet.getDataRange().getValues();
  const hashed = hashPassword_(password);

  for (let i = 1; i < data.length; i++) {
    const [id, nama, uname, pwd, role, status] = data[i];
    if (String(uname) !== username || String(status) !== 'Aktif') continue;

    // Cast ke string agar angka numerik di sheet (mis. 123456) tetap cocok
    const pwdStr = String(pwd);
    const match  = (pwdStr === hashed) || (pwdStr === String(password));
    if (match) {
      // Auto-upgrade plain text → hash
      if (pwdStr !== hashed) sheet.getRange(i + 1, 4).setValue(hashed);
      return { success: true, user: { id, nama, username: String(uname), role: normalizeRole_(role) } };
    }
  }
  return { success: false, message: 'Username/password salah atau akun tidak aktif.' };
}

function verifyUser_(username) {
  const data = getSheet_('Users').getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) === username && String(data[i][5]) === 'Aktif') {
      return { valid: true, nama: data[i][1], role: normalizeRole_(data[i][4]), rowIndex: i + 1 };
    }
  }
  return { valid: false };
}

// Ubah password — verifikasi password lama, simpan hash baru
function changePassword(username, oldPassword, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    return { success: false, message: 'Password baru minimal 6 karakter.' };
  }
  const sheet     = getSheet_('Users');
  const data      = sheet.getDataRange().getValues();
  const oldHashed = hashPassword_(oldPassword);
  const newHashed = hashPassword_(newPassword);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) === username && String(data[i][5]) === 'Aktif') {
      const stored = String(data[i][3]);
      if (stored !== String(oldPassword) && stored !== oldHashed) {
        return { success: false, message: 'Password lama tidak sesuai.' };
      }
      sheet.getRange(i + 1, 4).setValue(newHashed);
      return { success: true };
    }
  }
  return { success: false, message: 'User tidak ditemukan.' };
}

// ─── ABSENSI ─────────────────────────────────────────────────
function getAbsensiStatus(username) {
  const u = verifyUser_(username);
  if (!u.valid) return { error: 'Unauthorized' };

  const now = new Date();
  const timeStr = Utilities.formatDate(now, 'Asia/Jakarta', 'HH:mm');
  const hour = parseInt(timeStr.substring(0, 2), 10);
  const isOpen = (hour >= 7 && hour < 20);

  const today   = fmt_(now, 'yyyy-MM-dd');
  const idAbsen = today + '_' + username;
  const data    = getSheet_('Absensi').getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === idAbsen) {
      return {
        status:          data[i][4] ? 'selesai' : 'sudah_masuk',
        jamMasuk:        data[i][3] ? fmt_(data[i][3], 'HH:mm') : '',
        jamPulang:       data[i][4] ? fmt_(data[i][4], 'HH:mm') : '',
        statusKehadiran: data[i][5],
        lokasiMasuk:  (data[i][6] && data[i][7])  ? { lat: data[i][6],  lng: data[i][7]  } : null,
        lokasiPulang: (data[i][8] && data[i][9])  ? { lat: data[i][8],  lng: data[i][9]  } : null,
        isOpen: isOpen,
        serverTime: timeStr
      };
    }
  }
  return { status: 'belum_absen', isOpen: isOpen, serverTime: timeStr };
}

function absenMasuk(username, statusKehadiran, lokasi) {
  const u = verifyUser_(username);
  if (!u.valid) return { success: false, message: 'Unauthorized' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const now = new Date();
    const timeStr = Utilities.formatDate(now, 'Asia/Jakarta', 'HH:mm');
    const hour = parseInt(timeStr.substring(0, 2), 10);
    if (hour < 7 || hour >= 20) {
      return { success: false, message: `Absensi sedang ditutup (07:00 - 20:00 WIB). Waktu server saat ini: ${timeStr}` };
    }

    const today   = fmt_(now, 'yyyy-MM-dd');
    const idAbsen = today + '_' + username;
    const sheet   = getSheet_('Absensi');
    const data    = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === idAbsen) return { success: false, message: 'Sudah absen masuk hari ini.' };
    }
    const lat = (lokasi && lokasi.lat) ? lokasi.lat : '';
    const lng = (lokasi && lokasi.lng) ? lokasi.lng : '';
    sheet.appendRow([idAbsen, today, u.nama, now, '', statusKehadiran || 'Hadir', lat, lng, '', '']);
    return { success: true, jamMasuk: fmt_(now, 'HH:mm'), lokasiTercatat: !!(lat && lng) };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

function absenPulang(username, lokasi) {
  const u = verifyUser_(username);
  if (!u.valid) return { success: false, message: 'Unauthorized' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const now = new Date();
    const timeStr = Utilities.formatDate(now, 'Asia/Jakarta', 'HH:mm');
    const hour = parseInt(timeStr.substring(0, 2), 10);
    if (hour < 7 || hour >= 20) {
      return { success: false, message: `Absensi sedang ditutup (07:00 - 20:00 WIB). Waktu server saat ini: ${timeStr}` };
    }

    const today   = fmt_(now, 'yyyy-MM-dd');
    const idAbsen = today + '_' + username;
    const sheet   = getSheet_('Absensi');
    const data    = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === idAbsen) {
        if (data[i][4]) return { success: false, message: 'Absen pulang sudah tercatat.' };
        sheet.getRange(i + 1, 5).setValue(now);
        if (lokasi && lokasi.lat && lokasi.lng) {
          sheet.getRange(i + 1, 9, 1, 2).setValues([[lokasi.lat, lokasi.lng]]);
        }
        return { success: true, jamPulang: fmt_(now, 'HH:mm'), lokasiTercatat: !!(lokasi && lokasi.lat) };
      }
    }
    return { success: false, message: 'Data absen masuk tidak ditemukan.' };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ─── TUGAS ───────────────────────────────────────────────────
function submitTugas(username, form) {
  const u = verifyUser_(username);
  if (!u.valid) return { success: false, message: 'Unauthorized' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const sheet   = getSheet_('Input Aktivitas');
    const idTugas = 'TGS-' + fmt_(new Date(), 'yyyyMMddHHmmss');
    sheet.appendRow([
      idTugas, new Date(), form.tanggal, u.nama,
      form.jenisAktivitas, form.detailPekerjaan,
      form.waktuMulai,     form.waktuSelesai,
      form.statusProgres,  form.linkBukti  || '',
      form.kendala       || '',
      form.instansi      || '',
      form.alamat        || '',
      form.pic           || ''
    ]);
    return { success: true, idTugas };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

function _mapTugas_(r) {
  return {
    idTugas:         r[0],
    tanggal:         r[2] instanceof Date ? fmt_(r[2], 'yyyy-MM-dd') : String(r[2]),
    nama:            String(r[3] || '').trim(),
    jenisAktivitas:  r[4],
    detailPekerjaan: r[5],
    waktuMulai:      r[6] instanceof Date ? fmt_(r[6], 'HH:mm') : String(r[6] || ''),
    waktuSelesai:    r[7] instanceof Date ? fmt_(r[7], 'HH:mm') : String(r[7] || ''),
    statusProgres:   r[8],
    linkBukti:       r[9]  || '',
    kendala:         r[10] || '',
    instansi:        r[11] || '',
    alamat:          r[12] || '',
    pic:             r[13] || ''
  };
}

function getTugasHariIni(username) {
  const u = verifyUser_(username);
  if (!u.valid) return [];

  const today = fmt_(new Date(), 'yyyy-MM-dd');
  const data  = getSheet_('Input Aktivitas').getDataRange().getValues();
  return data.slice(1)
    .filter(r => {
      const tgl = r[2] instanceof Date ? fmt_(r[2], 'yyyy-MM-dd') : String(r[2]);
      return tgl === today && String(r[3]).trim() === u.nama.trim();
    })
    .map(_mapTugas_);
}

function getRiwayatKegiatan(username) {
  const u = verifyUser_(username);
  if (!u.valid) return [];

  const sheet = getSheet_('Input Aktivitas');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  // Kembalikan semua data — filter nama dilakukan di client-side
  return data.slice(1).map(_mapTugas_).reverse();
}

// ─── REFERENSI (Admin) ────────────────────────────────────────
function getJenisAktivitas() {
  const data = getSheet_('Referensi').getDataRange().getValues();
  return data.slice(1).map(r => r[0]).filter(Boolean);
}

function manageReferensi(username, action, value) {
  const u = verifyUser_(username);
  if (!u.valid || (u.role !== 'Admin' && u.role !== 'Owner')) {
    return { success: false, message: 'Unauthorized' };
  }
  const sheet = getSheet_('Referensi');
  if (action === 'add') {
    sheet.appendRow([value]);
    return { success: true };
  }
  if (action === 'delete') {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === value) { sheet.deleteRow(i + 1); return { success: true }; }
    }
    return { success: false, message: 'Item tidak ditemukan.' };
  }
  return { success: false, message: 'Action tidak valid.' };
}

// ─── KELOLA USER (Admin) ──────────────────────────────────────
function getUsers(username) {
  const u = verifyUser_(username);
  if (!u.valid || u.role !== 'Admin') return { error: 'Unauthorized' };

  const data = getSheet_('Users').getDataRange().getValues();
  return data.slice(1).map((r, i) => ({
    rowIndex: i + 2,
    id:       r[0], nama:     r[1],
    username: r[2], role:     r[4], status: r[5]
  }));
}

function addUser(username, userData) {
  const u = verifyUser_(username);
  if (!u.valid || u.role !== 'Admin') return { success: false, message: 'Unauthorized' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getSheet_('Users');
    const data  = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][2] === userData.username) {
        return { success: false, message: 'Username sudah digunakan.' };
      }
    }
    const hashed = hashPassword_(userData.password);
    sheet.appendRow([
      userData.id, userData.nama, userData.username,
      hashed, userData.role, userData.status || 'Aktif'
    ]);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

function updateUser(username, rowIndex, userData) {
  const u = verifyUser_(username);
  if (!u.valid || u.role !== 'Admin') return { success: false, message: 'Unauthorized' };

  const sheet  = getSheet_('Users');
  const oldPwd = sheet.getRange(rowIndex, 4).getValue();
  const newPwd = userData.password ? hashPassword_(userData.password) : oldPwd;

  sheet.getRange(rowIndex, 1, 1, 6).setValues([[
    userData.id, userData.nama, userData.username,
    newPwd, userData.role, userData.status
  ]]);
  return { success: true };
}

function toggleUserStatus(username, targetUsername) {
  const u = verifyUser_(username);
  if (!u.valid || u.role !== 'Admin') return { success: false, message: 'Unauthorized' };
  if (username === targetUsername) return { success: false, message: 'Tidak bisa menonaktifkan akun sendiri.' };

  const sheet = getSheet_('Users');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === targetUsername) {
      const newStatus = data[i][5] === 'Aktif' ? 'Nonaktif' : 'Aktif';
      sheet.getRange(i + 1, 6).setValue(newStatus);
      return { success: true, newStatus };
    }
  }
  return { success: false, message: 'User tidak ditemukan.' };
}

// ─── STATISTIK (Owner) ────────────────────────────────────────
function getRekapAbsensi(username) {
  const u = verifyUser_(username);
  if (!u.valid || u.role !== 'Owner') return { error: 'Unauthorized' };

  const data = getSheet_('Absensi').getDataRange().getValues();
  return data.slice(1).map(r => ({
    idAbsen:         r[0],
    tanggal:         r[1] instanceof Date ? fmt_(r[1], 'yyyy-MM-dd') : String(r[1]),
    nama:            r[2],
    jamMasuk:        r[3] instanceof Date ? fmt_(r[3], 'HH:mm') : String(r[3] || ''),
    jamPulang:       r[4] instanceof Date ? fmt_(r[4], 'HH:mm') : String(r[4] || ''),
    statusKehadiran: r[5],
    lokasiMasuk:  (r[6] && r[7]) ? { lat: r[6], lng: r[7] } : null,
    lokasiPulang: (r[8] && r[9]) ? { lat: r[8], lng: r[9] } : null
  }));
}

function getSemuaTugas(username) {
  const u = verifyUser_(username);
  if (!u.valid || u.role !== 'Owner') return { error: 'Unauthorized' };

  const data = getSheet_('Input Aktivitas').getDataRange().getValues();
  return data.slice(1).map(r => ({
    idTugas:         r[0],
    tanggal:         r[2] instanceof Date ? fmt_(r[2], 'yyyy-MM-dd') : String(r[2]),
    nama:            r[3],
    jenisAktivitas:  r[4],
    detailPekerjaan: r[5],
    waktuMulai:      r[6] instanceof Date ? fmt_(r[6], 'HH:mm') : String(r[6] || ''),
    waktuSelesai:    r[7] instanceof Date ? fmt_(r[7], 'HH:mm') : String(r[7] || ''),
    statusProgres:   r[8],
    linkBukti:       r[9] || '',
    kendala:         r[10] || '',
    instansi:        r[11] || '',
    alamat:          r[12] || '',
    pic:             r[13] || ''
  }));
}

function getStatistikPublik() {
  const today = fmt_(new Date(), 'yyyy-MM-dd');
  const data  = getSheet_('Absensi').getDataRange().getValues();
  const c     = { Hadir: 0, WFO: 0, WFH: 0, Izin: 0, Sakit: 0 };

  data.slice(1).forEach(r => {
    const tgl = r[1] instanceof Date ? fmt_(r[1], 'yyyy-MM-dd') : String(r[1]);
    if (tgl === today && c.hasOwnProperty(r[5])) c[r[5]]++;
  });

  const trend = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    trend[fmt_(d, 'yyyy-MM-dd')] = { hadir: 0, tidak: 0 };
  }
  data.slice(1).forEach(r => {
    const tgl = r[1] instanceof Date ? fmt_(r[1], 'yyyy-MM-dd') : String(r[1]);
    if (trend[tgl]) {
      if (r[5] === 'Hadir' || r[5] === 'WFO' || r[5] === 'WFH') trend[tgl].hadir++;
      else trend[tgl].tidak++;
    }
  });

  return { tanggal: today, counts: c, trend };
}

// ─── SETUP HELPER ─────────────────────────────────────────────
function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const sheets = {
    'Users': ['ID_User', 'Nama_Lengkap', 'Username', 'Password', 'Role', 'Status'],
    'Absensi': ['ID_Absen', 'Tanggal', 'Nama_Lengkap', 'Jam_Masuk', 'Jam_Pulang', 'Status_Kehadiran',
                'Latitude_Masuk', 'Longitude_Masuk', 'Latitude_Pulang', 'Longitude_Pulang'],
    'Input Aktivitas': [
      'ID_Tugas', 'Timestamp', 'Tanggal', 'Nama_Lengkap', 'Jenis_Aktivitas',
      'Detail_Pekerjaan', 'Waktu_Mulai', 'Waktu_Selesai', 'Status_Progres',
      'Link_Bukti', 'Kendala', 'Instansi/Perusahaan', 'Alamat', 'PIC'
    ],
    'Referensi': ['Daftar_Jenis_Aktivitas']
  };

  Object.entries(sheets).forEach(([name, headers]) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (!sheet.getRange(1, 1).getValue()) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setBackground('#065f46').setFontColor('#ffffff').setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });

  const refSheet = ss.getSheetByName('Referensi');
  if (refSheet.getLastRow() <= 1) {
    const contoh = ['Kunjungan Klien', 'Rapat Tim', 'Presentasi', 'Administrasi',
                    'Pengembangan Fitur', 'Bug Fixing', 'Training', 'Support',
                    'Dokumentasi', 'Lainnya'];
    refSheet.getRange(2, 1, contoh.length, 1).setValues(contoh.map(v => [v]));
  }

  const userSheet = ss.getSheetByName('Users');
  if (userSheet.getLastRow() <= 1) {
    userSheet.appendRow(['USR001', 'Administrator', 'admin', hashPassword_('admin123'), 'Owner', 'Aktif']);
    userSheet.appendRow(['USR002', 'Admin Sistem',  'adminsys', hashPassword_('admin123'), 'Admin', 'Aktif']);
  }

  SpreadsheetApp.getUi().alert('✅ Setup selesai!');
}
